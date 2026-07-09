import { NextResponse } from "next/server";
import { isNuvioConfigured, parseNuvioItem, pullNuvioLibrary } from "@/lib/nuvio";
import {
  getDislikedKeys,
  getLikedKeys,
  getWatchlistKeys,
  isConfigured,
  itemKey,
  markWatchlistMany,
} from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Pull the Nuvio library and insert any titles StreamMatch hasn't seen yet
 * into the watchlist. Titles already on any list (watchlist, liked, disliked)
 * are left alone so sync never resurrects something the user already rated.
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

    const library = await pullNuvioLibrary();

    const [watchlist, liked, disliked] = await Promise.all([
      getWatchlistKeys(),
      getLikedKeys(),
      getDislikedKeys(),
    ]);

    let unsupported = 0;
    const fresh = new Map<string, { tmdbId: number; mediaType: "movie" | "tv"; title: string }>();
    for (const item of library) {
      const parsed = parseNuvioItem(item);
      if (!parsed) {
        unsupported++;
        continue;
      }
      const key = itemKey(parsed.mediaType, parsed.tmdbId);
      if (watchlist.has(key) || liked.has(key) || disliked.has(key)) continue;
      fresh.set(key, parsed);
    }

    await markWatchlistMany([...fresh.values()]);

    return NextResponse.json({
      ok: true,
      pulled: library.length,
      added: fresh.size,
      skipped: library.length - unsupported - fresh.size,
      unsupported,
    });
  } catch (err) {
    console.error("[/api/nuvio/sync POST]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
