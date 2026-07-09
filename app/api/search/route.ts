import { NextResponse } from "next/server";
import { curatedFeed, popularTitles, searchTitles } from "@/lib/tmdb";
import {
  getAppSettings,
  getDislikedKeys,
  getLikedKeys,
  getWatchlistKeys,
  itemKey,
  listDisliked,
  listLiked,
  listWatchlist,
  type ListItem,
} from "@/lib/supabase";
import type { MediaType, Recommendation, SearchResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function annotate(
  titles: (Recommendation & { related?: boolean })[],
  watchlist: Set<string>,
  liked: Set<string>,
  disliked: Set<string>,
): SearchResult[] {
  return titles.map((t) => {
    const key = itemKey(t.mediaType as MediaType, t.id);
    return {
      ...t,
      related: t.related === true,
      inWatchlist: watchlist.has(key),
      sentiment: liked.has(key) ? "liked" : disliked.has(key) ? "disliked" : null,
    };
  });
}

/**
 * Browse/search endpoint for the /search page.
 * - With `q`: direct TMDB matches plus related "more like this" picks.
 * - Without `q`: a paginated personalized feed seeded from the watchlist,
 *   liked, and disliked lists — falling back to popular titles when the
 *   lists are empty. Items are annotated with watchlist membership and any
 *   existing liked/disliked sentiment.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    // feed=popular forces the unpersonalized popularity feed; the default
    // ("recommended") uses the curated feed whenever seeds exist.
    const wantPopular = url.searchParams.get("feed") === "popular";

    // Preferred original language and region from Settings; language defaults
    // to English ("" = any), region to the TMDB_REGION env (US).
    const stored = await getAppSettings();
    const language =
      typeof stored.preferred_language === "string" ? stored.preferred_language : "en";
    const watchRegion =
      typeof stored.preferred_region === "string" && stored.preferred_region
        ? stored.preferred_region
        : process.env.TMDB_REGION || "US";

    if (q) {
      const [titles, watchlist, liked, disliked] = await Promise.all([
        searchTitles(q, language),
        getWatchlistKeys(),
        getLikedKeys(),
        getDislikedKeys(),
      ]);
      return NextResponse.json({
        items: annotate(titles, watchlist, liked, disliked),
        hasMore: false,
        mode: "search",
      });
    }

    const [watchlistItems, likedItems, dislikedItems] = await Promise.all([
      listWatchlist(),
      listLiked(),
      listDisliked(),
    ]);
    const toSeed = (i: ListItem) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType });
    const toKeys = (items: ListItem[]) =>
      new Set(items.map((i) => itemKey(i.mediaType, i.tmdbId)));
    const useCurated = !wantPopular && watchlistItems.length + likedItems.length > 0;

    const { items: titles, hasMore } = useCurated
      ? await curatedFeed({
          liked: likedItems.map(toSeed),
          watchlist: watchlistItems.map(toSeed),
          disliked: dislikedItems.map(toSeed),
          page,
          language,
        })
      : await popularTitles(page, language, watchRegion);

    return NextResponse.json({
      items: annotate(titles, toKeys(watchlistItems), toKeys(likedItems), toKeys(dislikedItems)),
      hasMore,
      mode: useCurated ? "curated" : "popular",
    });
  } catch (err) {
    console.error("[/api/search GET]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Search failed: ${message}` }, { status: 500 });
  }
}
