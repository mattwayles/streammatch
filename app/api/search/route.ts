import { NextResponse } from "next/server";
import { curatedFeed, popularTitles, searchTitles } from "@/lib/tmdb";
import {
  getWatchlistKeys,
  itemKey,
  listDisliked,
  listLiked,
  listWatchlist,
  type ListItem,
} from "@/lib/supabase";
import type { SearchResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Browse/search endpoint for the /search page.
 * - With `q`: direct TMDB matches plus related "more like this" picks.
 * - Without `q`: a paginated personalized feed seeded from the watchlist,
 *   liked, and disliked lists — falling back to popular titles when the
 *   lists are empty. Every item is annotated with watchlist membership.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    if (q) {
      const [titles, watchlist] = await Promise.all([searchTitles(q), getWatchlistKeys()]);
      const items: SearchResult[] = titles.map((t) => ({
        ...t,
        inWatchlist: watchlist.has(itemKey(t.mediaType, t.id)),
      }));
      return NextResponse.json({ items, hasMore: false, mode: "search" });
    }

    const [watchlistItems, likedItems, dislikedItems] = await Promise.all([
      listWatchlist(),
      listLiked(),
      listDisliked(),
    ]);
    const toSeed = (i: ListItem) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType });
    const hasSeeds = watchlistItems.length + likedItems.length > 0;

    const { items: titles, hasMore } = hasSeeds
      ? await curatedFeed({
          liked: likedItems.map(toSeed),
          watchlist: watchlistItems.map(toSeed),
          disliked: dislikedItems.map(toSeed),
          page,
        })
      : await popularTitles(page);

    const watchlist = new Set(watchlistItems.map((i) => itemKey(i.mediaType, i.tmdbId)));
    const items: SearchResult[] = titles.map((t) => ({
      ...t,
      related: false,
      inWatchlist: watchlist.has(itemKey(t.mediaType, t.id)),
    }));

    return NextResponse.json({ items, hasMore, mode: hasSeeds ? "curated" : "popular" });
  } catch (err) {
    console.error("[/api/search GET]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Search failed: ${message}` }, { status: 500 });
  }
}
