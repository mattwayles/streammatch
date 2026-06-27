import { NextResponse } from "next/server";
import { buildCandidatePool, buildCandidatesFromIds } from "@/lib/tmdb";
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
import { withTimeout } from "@/lib/timeout";
import type { MoodProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Builds the curation inputs: a filtered TMDB candidate pool plus the user's
 * taste context (liked/disliked/watched/watchlist titles). This is the slow,
 * variable I/O half of recommendations (TMDB + Supabase) — split out from
 * /api/recommend so the LLM call gets its own time budget. The client calls
 * this first, then passes the result straight into /api/recommend.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const profile: MoodProfile | undefined = body?.profile;
    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
    }

    let allCandidates;
    if (profile.watchlistMode) {
      const watchlistItems = await withTimeout(listWatchlist(), 10000, "listWatchlist");
      if (watchlistItems.length === 0) {
        return NextResponse.json({ candidates: [], watchlistEmpty: true });
      }
      allCandidates = await withTimeout(
        buildCandidatesFromIds(
          watchlistItems.map((item) => ({ id: item.tmdbId, mediaType: item.mediaType })),
        ),
        20000,
        "buildCandidatesFromIds",
      );
    } else {
      allCandidates = await withTimeout(buildCandidatePool(profile), 30000, "buildCandidatePool");
    }

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

    const candidates = allCandidates.filter((c) => {
      const k = watchedKey(c.mediaType, c.id);
      // In watchlist mode keep items regardless of watched/watchlist status — user explicitly saved them.
      if (profile.watchlistMode) return !disliked.has(k);
      // Exclude watched, disliked, liked, and watchlist items from regular recommendations.
      return !watched.has(k) && !disliked.has(k) && !liked.has(k) && !watchlistSet.has(k);
    });

    const dislikedTitles = dislikedList
      .map((d) => d.title)
      .filter(Boolean)
      .slice(0, 30);

    const likedTitles = likedList
      .map((l) => l.title)
      .filter(Boolean)
      .slice(0, 30);

    const watchedTitles = allCandidates
      .filter((c) => watched.has(watchedKey(c.mediaType, c.id)))
      .map((c) => c.title)
      .slice(0, 20);

    const watchlistTitles = allCandidates
      .filter((c) => watchlistSet.has(watchedKey(c.mediaType, c.id)))
      .map((c) => c.title)
      .slice(0, 20);

    return NextResponse.json({
      candidates,
      dislikedTitles,
      likedTitles,
      watchedTitles,
      watchlistTitles,
    });
  } catch (err) {
    console.error("[/api/candidates]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Candidate build failed: ${message}` },
      { status: 500 },
    );
  }
}
