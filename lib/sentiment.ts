import { isNuvioSyncEnabled, removeFromNuvioLibrary } from "./nuvio";
import {
  getWatchlistKeys,
  itemKey,
  markDisliked,
  markLiked,
  unmarkDisliked,
  unmarkLiked,
  unmarkWatchlist,
} from "./supabase";
import { imdbIdFor } from "./tmdb";
import type { MediaType } from "./types";

export type Sentiment = "liked" | "disliked";

export interface SentimentResult {
  /** The title was on the watchlist and has been removed from it. */
  watchlistRemoved: boolean;
  /** Outcome of the Nuvio library removal (only attempted when it was on the watchlist). */
  nuvio: "removed" | "skipped" | "failed";
}

/**
 * Record a liked/disliked sentiment while enforcing list exclusivity: a title
 * lives in at most one of watchlist / liked / disliked. Marking a sentiment
 * clears the opposite sentiment, pulls the title off the watchlist, and — when
 * Nuvio sync is enabled — removes it from the Nuvio library (best-effort).
 */
export async function recordSentiment(
  kind: Sentiment,
  tmdbId: number,
  mediaType: MediaType,
  title: string,
): Promise<SentimentResult> {
  const watchlistKeys = await getWatchlistKeys();
  const wasOnWatchlist = watchlistKeys.has(itemKey(mediaType, tmdbId));

  if (kind === "liked") {
    await markLiked(tmdbId, mediaType, title);
    await unmarkDisliked(tmdbId, mediaType);
  } else {
    await markDisliked(tmdbId, mediaType, title);
    await unmarkLiked(tmdbId, mediaType);
  }
  if (wasOnWatchlist) await unmarkWatchlist(tmdbId, mediaType);

  let nuvio: SentimentResult["nuvio"] = "skipped";
  if (wasOnWatchlist && (await isNuvioSyncEnabled())) {
    try {
      const imdbId = await imdbIdFor(mediaType, tmdbId);
      nuvio = (await removeFromNuvioLibrary(tmdbId, mediaType, imdbId)) ? "removed" : "skipped";
    } catch (err) {
      console.error(`[sentiment] Nuvio removal failed for ${mediaType}:${tmdbId}:`, err);
      nuvio = "failed";
    }
  }

  return { watchlistRemoved: wasOnWatchlist, nuvio };
}
