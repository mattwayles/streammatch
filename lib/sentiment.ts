import { isNuvioSyncEnabled, markWatchedOnNuvio, removeFromNuvioLibrary } from "./nuvio";
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
  /** Outcome of recording the title in Nuvio's watch history. */
  nuvioWatched: "synced" | "skipped" | "failed";
}

/**
 * Record a liked/disliked sentiment while enforcing list exclusivity: a title
 * lives in at most one of watchlist / liked / disliked. Marking a sentiment
 * clears the opposite sentiment and pulls the title off the watchlist. When
 * Nuvio sync is enabled, rating also records the title in Nuvio's watch
 * history (rating implies it was watched) and removes it from the Nuvio
 * library if it was on the watchlist — both best-effort.
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
  let nuvioWatched: SentimentResult["nuvioWatched"] = "skipped";
  if (await isNuvioSyncEnabled()) {
    const imdbId = await imdbIdFor(mediaType, tmdbId);

    // Rating implies the title has been watched — record it in Nuvio history.
    try {
      await markWatchedOnNuvio({ tmdbId, mediaType, title, imdbId });
      nuvioWatched = "synced";
    } catch (err) {
      console.error(`[sentiment] Nuvio watched push failed for ${mediaType}:${tmdbId}:`, err);
      nuvioWatched = "failed";
    }

    if (wasOnWatchlist) {
      try {
        nuvio = (await removeFromNuvioLibrary(tmdbId, mediaType, imdbId)) ? "removed" : "skipped";
      } catch (err) {
        console.error(`[sentiment] Nuvio removal failed for ${mediaType}:${tmdbId}:`, err);
        nuvio = "failed";
      }
    }
  }

  return { watchlistRemoved: wasOnWatchlist, nuvio, nuvioWatched };
}
