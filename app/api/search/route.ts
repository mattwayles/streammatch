import { NextResponse } from "next/server";
import { popularTitles, searchTitles } from "@/lib/tmdb";
import { getWatchlistKeys, itemKey } from "@/lib/supabase";
import type { SearchResult } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Browse/search endpoint for the /search page. Without `q` it returns the top
 * titles by TMDB popularity; with `q` it returns direct matches plus related
 * "more like this" picks. Every item is annotated with watchlist membership.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

    const [titles, watchlist] = await Promise.all([
      q ? searchTitles(q) : popularTitles(),
      getWatchlistKeys(),
    ]);

    const items: SearchResult[] = titles.map((t) => ({
      ...t,
      related: "related" in t && t.related === true,
      inWatchlist: watchlist.has(itemKey(t.mediaType, t.id)),
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[/api/search GET]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Search failed: ${message}` }, { status: 500 });
  }
}
