import { NextResponse } from "next/server";
import { addToNuvioLibrary, isNuvioConfigured } from "@/lib/nuvio";
import {
  isConfigured,
  listWatchlist,
  markWatchlist,
  unmarkWatchlist,
  updateWatchlistPosters,
} from "@/lib/supabase";
import { posterFor } from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const POSTER_BATCH = 10;

export async function GET() {
  try {
    const items = await listWatchlist();

    // Backfill poster art for rows saved before posters were stored (e.g. the
    // initial Nuvio import). Fetched from TMDB, then persisted best-effort so
    // subsequent loads are instant.
    const missing = items.filter((i) => !i.posterUrl);
    if (missing.length > 0 && process.env.TMDB_API_KEY) {
      const found: { tmdbId: number; mediaType: MediaType; poster: string }[] = [];
      for (let i = 0; i < missing.length; i += POSTER_BATCH) {
        const batch = missing.slice(i, i + POSTER_BATCH);
        const posters = await Promise.all(
          batch.map((item) => posterFor(item.mediaType, item.tmdbId)),
        );
        posters.forEach((poster, j) => {
          if (!poster) return;
          batch[j].posterUrl = poster;
          found.push({ tmdbId: batch[j].tmdbId, mediaType: batch[j].mediaType, poster });
        });
      }
      await updateWatchlistPosters(found);
    }

    return NextResponse.json({ items, configured: isConfigured() });
  } catch (err) {
    console.error("[/api/watchlist GET]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not load: ${message}` }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const tmdbId = Number(body?.tmdbId);
    const mediaType = body?.mediaType as MediaType;
    const title = typeof body?.title === "string" ? body.title : "";

    if (!Number.isFinite(tmdbId) || (mediaType !== "movie" && mediaType !== "tv")) {
      return NextResponse.json({ error: "Invalid tmdbId or mediaType" }, { status: 400 });
    }

    const poster = typeof body?.poster === "string" ? body.poster : null;
    await markWatchlist(tmdbId, mediaType, title, poster);

    // Mirror the new item to the Nuvio library. Best-effort: a Nuvio outage
    // must never block saving to the local watchlist.
    let nuvio: "synced" | "skipped" | "failed" = "skipped";
    if (isNuvioConfigured()) {
      try {
        await addToNuvioLibrary({
          tmdbId,
          mediaType,
          title,
          poster: typeof body?.poster === "string" ? body.poster : undefined,
          background: typeof body?.background === "string" ? body.background : undefined,
          description: typeof body?.description === "string" ? body.description : undefined,
          releaseInfo: typeof body?.year === "string" ? body.year : undefined,
        });
        nuvio = "synced";
      } catch (err) {
        console.error("[/api/watchlist POST] Nuvio push failed:", err);
        nuvio = "failed";
      }
    }

    return NextResponse.json({ ok: true, nuvio });
  } catch (err) {
    console.error("[/api/watchlist POST]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not save: ${message}` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const tmdbId = Number(body?.tmdbId);
    const mediaType = body?.mediaType as MediaType;

    if (!Number.isFinite(tmdbId) || (mediaType !== "movie" && mediaType !== "tv")) {
      return NextResponse.json({ error: "Invalid tmdbId or mediaType" }, { status: 400 });
    }

    await unmarkWatchlist(tmdbId, mediaType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/watchlist DELETE]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not remove: ${message}` }, { status: 500 });
  }
}
