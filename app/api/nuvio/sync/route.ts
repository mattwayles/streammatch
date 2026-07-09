import { NextResponse } from "next/server";
import {
  isNuvioConfigured,
  isNuvioSyncEnabled,
  parseNuvioItem,
  pullNuvioLibrary,
  pullNuvioWatched,
  type NuvioLibraryItem,
} from "@/lib/nuvio";
import { findByImdbId } from "@/lib/tmdb";
import {
  getDislikedKeys,
  getLikedKeys,
  getWatchlistKeys,
  isConfigured,
  itemKey,
  markLikedMany,
  markWatchlistMany,
} from "@/lib/supabase";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESOLVE_BATCH = 10;

interface ResolvedRef {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  poster: string | null;
}

interface ResolveOutcome {
  resolved: ResolvedRef[];
  unsupportedIds: string[];
  unresolved: number;
}

/** Map Nuvio content refs to TMDB identities, resolving IMDb-keyed items via
 * TMDB /find in bounded batches. Input should already be deduped. */
async function resolveRefs(items: NuvioLibraryItem[]): Promise<ResolveOutcome> {
  const resolved: ResolvedRef[] = [];
  const unsupportedIds: string[] = [];
  const imdbItems: {
    imdbId: string;
    mediaType: MediaType | null;
    title: string;
    poster: string | null;
  }[] = [];

  for (const item of items) {
    const parsed = parseNuvioItem(item);
    if (!parsed) unsupportedIds.push(item.content_id ?? "(empty)");
    else if (parsed.source === "tmdb") resolved.push(parsed);
    else imdbItems.push(parsed);
  }

  let unresolved = 0;
  for (let i = 0; i < imdbItems.length; i += RESOLVE_BATCH) {
    const batch = imdbItems.slice(i, i + RESOLVE_BATCH);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          return await findByImdbId(item.imdbId, item.mediaType ?? undefined);
        } catch (err) {
          console.error(`[/api/nuvio/sync] TMDB find(${item.imdbId}):`, err);
          return null;
        }
      }),
    );
    results.forEach((found, j) => {
      if (found) resolved.push({ ...found, title: batch[j].title, poster: batch[j].poster });
      else {
        unresolved++;
        unsupportedIds.push(batch[j].imdbId);
      }
    });
  }

  return { resolved, unsupportedIds, unresolved };
}

/**
 * Pull the Nuvio library AND watch history:
 * - Watched titles (Nuvio has no like/dislike sentiment) are inserted into the
 *   liked list — watching implies having seen it, and liked is the positive
 *   default. Per-episode series entries collapse to one series title.
 * - Library titles are inserted into the watchlist.
 * Both are additive only: titles already on any local list are never moved,
 * and a new title present in both sources lands in liked (it's been watched).
 */
export async function POST() {
  try {
    if (!isNuvioConfigured()) {
      return NextResponse.json(
        { error: "Nuvio sync is not configured (set NUVIO_EMAIL and NUVIO_PASSWORD)." },
        { status: 400 },
      );
    }
    if (!isConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured (set SUPABASE_URL and SUPABASE_ANON_KEY)." },
        { status: 400 },
      );
    }
    if (!(await isNuvioSyncEnabled())) {
      return NextResponse.json(
        { error: "Nuvio sync is disabled in Settings." },
        { status: 400 },
      );
    }

    const [library, watchedRaw] = await Promise.all([pullNuvioLibrary(), pullNuvioWatched()]);

    // Collapse per-episode watch history to unique titles before resolving.
    const watchedUnique = new Map<string, NuvioLibraryItem>();
    for (const w of watchedRaw) {
      const key = `${w.content_type}:${w.content_id}`;
      if (!watchedUnique.has(key)) {
        watchedUnique.set(key, {
          content_id: w.content_id,
          content_type: w.content_type,
          name: w.title,
        });
      }
    }

    const [libraryRefs, watchedRefs] = await Promise.all([
      resolveRefs(library),
      resolveRefs([...watchedUnique.values()]),
    ]);

    const [watchlist, liked, disliked] = await Promise.all([
      getWatchlistKeys(),
      getLikedKeys(),
      getDislikedKeys(),
    ]);
    const taken = (key: string) => watchlist.has(key) || liked.has(key) || disliked.has(key);

    // Watched → liked, first claim on new titles.
    const likedAdditions = new Map<string, ResolvedRef>();
    for (const ref of watchedRefs.resolved) {
      const key = itemKey(ref.mediaType, ref.tmdbId);
      if (taken(key) || likedAdditions.has(key)) continue;
      likedAdditions.set(key, ref);
    }

    // Library → watchlist, skipping anything claimed above.
    const watchlistAdditions = new Map<string, ResolvedRef>();
    for (const ref of libraryRefs.resolved) {
      const key = itemKey(ref.mediaType, ref.tmdbId);
      if (taken(key) || likedAdditions.has(key) || watchlistAdditions.has(key)) continue;
      watchlistAdditions.set(key, ref);
    }

    await Promise.all([
      markLikedMany([...likedAdditions.values()]),
      markWatchlistMany([...watchlistAdditions.values()]),
    ]);

    const unsupportedIds = [...libraryRefs.unsupportedIds, ...watchedRefs.unsupportedIds];
    return NextResponse.json({
      ok: true,
      library: {
        pulled: library.length,
        added: watchlistAdditions.size,
        skipped: libraryRefs.resolved.length - watchlistAdditions.size,
      },
      watched: {
        pulled: watchedRaw.length,
        unique: watchedUnique.size,
        added: likedAdditions.size,
        skipped: watchedRefs.resolved.length - likedAdditions.size,
      },
      unsupported: unsupportedIds.length,
      unresolved: libraryRefs.unresolved + watchedRefs.unresolved,
      unsupportedSample: unsupportedIds.slice(0, 5),
    });
  } catch (err) {
    console.error("[/api/nuvio/sync POST]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
