import { NextResponse } from "next/server";
import { selectRecommendations } from "@/lib/anthropic";
import { buildCandidatePool, buildCandidatesFromIds, enrich } from "@/lib/tmdb";
import {
  getDislikedKeys,
  getLikedKeys,
  getWatchedKeys,
  getWatchlistKeys,
  listDisliked,
  listLiked,
  listWatchlist,
  watchedKey,
} from "@/lib/supabase";
import type { MoodProfile, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
// The whole request is designed to finish well under 60s (see HARD_DEADLINE_MS
// below). 60s is also the Hobby-plan ceiling, so a larger value would silently
// clamp; keep these two numbers in sync with each other.
export const maxDuration = 60;

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name} exceeded ${ms}ms timeout`)),
      ms,
    );
  });
  // Swallow the loser's eventual rejection so a settled race never produces an
  // unhandled promise rejection (which crashes the serverless function → 502).
  timeout.catch(() => {});
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function checkDeadline(startTime: number, remainingBudget: number): void {
  const elapsed = Date.now() - startTime;
  if (elapsed > remainingBudget) {
    throw new Error(`Deadline exceeded: ${elapsed}ms elapsed of ${remainingBudget}ms budget`);
  }
}

export async function POST(req: Request) {
  const requestStart = Date.now();
  const HARD_DEADLINE_MS = 55000; // 55s to stay under 60s function limit
  const timings: Record<string, number> = {};

  try {
    const body = await req.json().catch(() => ({}));
    const profile: MoodProfile | undefined = body?.profile;
    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
    }

    timings.start = 0;
    checkDeadline(requestStart, HARD_DEADLINE_MS);

    let allCandidates;
    let candidatePoolStart = Date.now();
    if (profile.watchlistMode) {
      checkDeadline(requestStart, HARD_DEADLINE_MS);
      const watchlistItems = await withTimeout(
        listWatchlist(),
        10000,
        "listWatchlist",
      );
      if (watchlistItems.length === 0) {
        return NextResponse.json({ recommendations: [], watchlistEmpty: true });
      }
      checkDeadline(requestStart, HARD_DEADLINE_MS);
      allCandidates = await withTimeout(
        buildCandidatesFromIds(
          watchlistItems.map((item) => ({ id: item.tmdbId, mediaType: item.mediaType })),
        ),
        15000,
        "buildCandidatesFromIds",
      );
    } else {
      checkDeadline(requestStart, HARD_DEADLINE_MS);
      allCandidates = await withTimeout(
        buildCandidatePool(profile),
        20000,
        "buildCandidatePool",
      );
    }
    timings.candidatePool = Date.now() - candidatePoolStart;

    checkDeadline(requestStart, HARD_DEADLINE_MS);

    // Filter out watched, liked (already seen), disliked, and saved watchlist titles.
    let supabaseStart = Date.now();
    const [watched, disliked, liked, watchlistSet, dislikedList, likedList] = await withTimeout(
      Promise.all([
        getWatchedKeys(),
        getDislikedKeys(),
        getLikedKeys(),
        getWatchlistKeys(),
        listDisliked(),
        listLiked(),
      ]),
      15000,
      "Supabase operations",
    );
    timings.supabase = Date.now() - supabaseStart;

    checkDeadline(requestStart, HARD_DEADLINE_MS);

    const candidates = allCandidates.filter((c) => {
      const k = watchedKey(c.mediaType, c.id);
      // In watchlist mode keep items regardless of watched/watchlist status — user explicitly saved them.
      if (profile.watchlistMode) return !disliked.has(k);
      // Exclude watched, disliked, liked, and watchlist items from regular recommendations.
      return !watched.has(k) && !disliked.has(k) && !liked.has(k) && !watchlistSet.has(k);
    });

    if (candidates.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    const dislikedTitles = dislikedList
      .map((d) => d.title)
      .filter(Boolean)
      .slice(0, 30);

    const likedTitles = likedList
      .map((l) => l.title)
      .filter(Boolean)
      .slice(0, 30);

    const watchedTitles = (await Promise.resolve(
      allCandidates
        .filter((c) => watched.has(watchedKey(c.mediaType, c.id)))
        .map((c) => c.title)
        .slice(0, 20),
    )) as string[];

    const watchlistTitles = (await Promise.resolve(
      allCandidates
        .filter((c) => watchlistSet.has(watchedKey(c.mediaType, c.id)))
        .map((c) => c.title)
        .slice(0, 20),
    )) as string[];

    checkDeadline(requestStart, HARD_DEADLINE_MS);

    let picks = [];
    const timeUntilDeadline = HARD_DEADLINE_MS - (Date.now() - requestStart);
    const llmTimeout = Math.min(20000, Math.max(5000, timeUntilDeadline - 5000));

    let llmStart = Date.now();
    try {
      picks = await withTimeout(
        selectRecommendations(
          profile,
          candidates,
          dislikedTitles,
          likedTitles,
          watchedTitles,
          watchlistTitles,
        ),
        llmTimeout,
        "selectRecommendations (Anthropic)",
      );
      timings.llm = Date.now() - llmStart;
    } catch (err) {
      timings.llm = Date.now() - llmStart;
      console.error(
        `[selectRecommendations failed after ${timings.llm}ms, total elapsed: ${Date.now() - requestStart}ms] returning top candidates. Error:`,
        err,
      );
      console.error("[TIMING BREAKDOWN]", {
        candidatePool: timings.candidatePool,
        supabase: timings.supabase,
        llm: timings.llm,
        totalElapsed: Date.now() - requestStart,
      });
      // Fallback: return top candidates by popularity if LLM times out
      picks = candidates
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 15)
        .map((c) => ({
          id: c.id,
          mediaType: c.mediaType,
          whyThisFits: "Popular right now",
          vibeCheck: "Trending",
        }));
    }

    checkDeadline(requestStart, HARD_DEADLINE_MS);

    // Drop any pick the model invented that isn't in the real pool.
    const validKeys = new Set(candidates.map((c) => `${c.mediaType}:${c.id}`));
    const valid = picks.filter((p) => validKeys.has(`${p.mediaType}:${p.id}`));

    // Map picks to recommendations using candidate data (no enrichment to stay under 60s timeout).
    // Enrichment (providers, reviews, screenshots) happens client-side or in background.
    const recommendations: Recommendation[] = valid
      .map((pick) => {
        const candidate = candidates.find((c) => c.id === pick.id && c.mediaType === pick.mediaType);
        if (!candidate) return null;
        return {
          id: candidate.id,
          mediaType: candidate.mediaType,
          title: candidate.title,
          year: candidate.year,
          description: candidate.overview,
          rating: candidate.rating,
          voteCount: 0,
          screenshotUrl: null,
          posterUrl: null,
          providers: [],
          reviews: [],
          whyThisFits: pick.whyThisFits,
          vibeCheck: pick.vibeCheck,
        };
      })
      .filter((r): r is Recommendation => r !== null);

    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("[/api/recommend]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Recommendation failed: ${message}` },
      { status: 500 },
    );
  }
}
