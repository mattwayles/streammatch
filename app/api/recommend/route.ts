import { NextResponse } from "next/server";
import { selectRecommendations } from "@/lib/anthropic";
import { buildCandidatePool, enrich } from "@/lib/tmdb";
import { getWatchedKeys, watchedKey } from "@/lib/supabase";
import type { MoodProfile, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const profile: MoodProfile | undefined = body?.profile;
    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
    }

    const allCandidates = await buildCandidatePool(profile);

    // Hide anything already marked watched (single shared list).
    const watched = await getWatchedKeys();
    const candidates = allCandidates.filter(
      (c) => !watched.has(watchedKey(c.mediaType, c.id)),
    );

    if (candidates.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    const picks = await selectRecommendations(profile, candidates);

    // Drop any pick the model invented that isn't in the real pool.
    const validKeys = new Set(candidates.map((c) => `${c.mediaType}:${c.id}`));
    const valid = picks.filter((p) => validKeys.has(`${p.mediaType}:${p.id}`));

    const settled = await Promise.all(valid.map((p) => enrich(p)));
    const recommendations = settled.filter(
      (r): r is Recommendation => r !== null,
    );

    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("[/api/recommend]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Recommendation failed: ${message}` },
      { status: 500 },
    );
  }
}
