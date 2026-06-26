import { NextResponse } from "next/server";
import { isConfigured, listDisliked, markDisliked, unmarkDisliked } from "@/lib/supabase";
import type { MediaType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await listDisliked();
    return NextResponse.json({ items, configured: isConfigured() });
  } catch (err) {
    console.error("[/api/disliked GET]", err);
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

    await markDisliked(tmdbId, mediaType, title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/disliked POST]", err);
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

    await unmarkDisliked(tmdbId, mediaType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/disliked DELETE]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not remove: ${message}` }, { status: 500 });
  }
}
