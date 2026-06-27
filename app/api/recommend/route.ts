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
export const maxDuration = 180;

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${name} exceeded ${ms}ms timeout`)),
        ms,
      ),
    ),
  ]);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const profile: MoodProfile | undefined = body?.profile;
    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
    }

    let allCandidates;
    if (profile.watchlistMode) {
      // Build candidate pool from the user's saved watchlist instead of TMDB discover.
      const watchlistItems = await withTimeout(
        listWatchlist(),
        15000,
        "listWatchlist",
      );
      if (watchlistItems.length === 0) {
        return NextResponse.json({ recommendations: [], watchlistEmpty: true });
      }
      allCandidates = await withTimeout(
        buildCandidatesFromIds(
          watchlistItems.map((item) => ({ id: item.tmdbId, mediaType: item.mediaType })),
        ),
        30000,
        "buildCandidatesFromIds",
      );
    } else {
      allCandidates = await withTimeout(
        buildCandidatePool(profile),
        45000,
        "buildCandidatePool",
      );
    }

    // Filter out watched, liked (already seen), disliked, and saved watchlist titles.
    const [watched, disliked, liked, watchlistSet, dislikedList, likedList] = await withTimeout(
      Promise.all([
        getWatchedKeys(),
        getDislikedKeys(),
        getLikedKeys(),
        getWatchlistKeys(),
        listDisliked(),
        listLiked(),
      ]),
      20000,
      "Supabase operations",
    );

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

    const picks = await withTimeout(
      selectRecommendations(
        profile,
        candidates,
        dislikedTitles,
        likedTitles,
        watchedTitles,
        watchlistTitles,
      ),
      60000,
      "selectRecommendations (Anthropic)",
    );

    // Drop any pick the model invented that isn't in the real pool.
    const validKeys = new Set(candidates.map((c) => `${c.mediaType}:${c.id}`));
    const valid = picks.filter((p) => validKeys.has(`${p.mediaType}:${p.id}`));

    // Enrich in batches to avoid overwhelming TMDB and to be deadline-aware.
    // Batch size of 5 to keep latency reasonable. Total budget: 30s.
    const recommendations: Recommendation[] = [];
    const batchSize = 5;
    const enrichmentTimeoutPerBatch = 4000;
    for (let i = 0; i < valid.length; i += batchSize) {
      try {
        const batch = valid.slice(i, i + batchSize);
        const settled = await withTimeout(
          Promise.all(batch.map((p) => enrich(p))),
          enrichmentTimeoutPerBatch,
          `enrichBatch[${i}-${i + batch.length}]`,
        );
        recommendations.push(...settled.filter((r): r is Recommendation => r !== null));
      } catch (err) {
        console.error(`[enrich batch] timeout or error: ${err}`);
        break;
      }
    }

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
