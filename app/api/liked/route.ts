import { NextResponse } from "next/server";
import { isConfigured, listLiked, markLiked, unmarkLiked } from "@/lib/supabase";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await listLiked();
    return NextResponse.json({ items, configured: isConfigured() });
  } catch (err) {
    console.error("[/api/liked GET]", err);
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

    await markLiked(tmdbId, mediaType, title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/liked POST]", err);
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

    await unmarkLiked(tmdbId, mediaType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/liked DELETE]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not remove: ${message}` }, { status: 500 });
  }
}
