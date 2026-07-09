import { NextResponse } from "next/server";
import {
  isNuvioConfigured,
  isNuvioSyncEnabled,
  parseNuvioItem,
  pullNuvioLibrary,
} from "@/lib/nuvio";
import { findByImdbId } from "@/lib/tmdb";
import {
  getDislikedKeys,
  getLikedKeys,
  getWatchlistKeys,
  isConfigured,
  itemKey,
  markWatchlistMany,
} from "@/lib/supabase";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESOLVE_BATCH = 10;

interface SyncCandidate {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  poster: string | null;
}

/**
 * Pull the Nuvio library and insert any titles StreamMatch hasn't seen yet
 * into the watchlist. Nuvio ids are TMDB- or IMDb-backed; IMDb ids are
 * resolved to TMDB via /find. Titles already on any list (watchlist, liked,
 * disliked) are left alone so sync never resurrects something already rated.
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

    const library = await pullNuvioLibrary();

    const candidates: SyncCandidate[] = [];
    const imdbItems: {
      imdbId: string;
      mediaType: MediaType | null;
      title: string;
      poster: string | null;
    }[] = [];
    const unsupportedIds: string[] = [];
    for (const item of library) {
      const parsed = parseNuvioItem(item);
      if (!parsed) unsupportedIds.push(item.content_id ?? "(empty)");
      else if (parsed.source === "tmdb") candidates.push(parsed);
      else imdbItems.push(parsed);
    }

    // Resolve IMDb-backed items to TMDB identities in small parallel batches.
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
        if (found) candidates.push({ ...found, title: batch[j].title, poster: batch[j].poster });
        else {
          unresolved++;
          unsupportedIds.push(batch[j].imdbId);
        }
      });
    }

    const [watchlist, liked, disliked] = await Promise.all([
      getWatchlistKeys(),
      getLikedKeys(),
      getDislikedKeys(),
    ]);

    const fresh = new Map<string, SyncCandidate>();
    let skipped = 0;
    for (const c of candidates) {
      const key = itemKey(c.mediaType, c.tmdbId);
      if (watchlist.has(key) || liked.has(key) || disliked.has(key) || fresh.has(key)) {
        skipped++;
        continue;
      }
      fresh.set(key, c);
    }

    await markWatchlistMany([...fresh.values()]);

    return NextResponse.json({
      ok: true,
      pulled: library.length,
      added: fresh.size,
      skipped,
      unsupported: unsupportedIds.length,
      unresolved,
      unsupportedSample: unsupportedIds.slice(0, 5),
    });
  } catch (err) {
    console.error("[/api/nuvio/sync POST]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
