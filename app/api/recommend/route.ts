import { NextResponse } from "next/server";
import { selectRecommendations } from "@/lib/anthropic";
import type { Candidate, Pick } from "@/lib/anthropic";
import { withTimeout } from "@/lib/timeout";
import type { MoodProfile, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RecommendBody {
  profile?: MoodProfile;
  candidates?: Candidate[];
  dislikedTitles?: string[];
  likedTitles?: string[];
  watchedTitles?: string[];
  watchlistTitles?: string[];
}

/**
 * Pure LLM curation. Receives a pre-built candidate pool and taste context from
 * /api/candidates, runs the model selection, and maps picks back to display
 * recommendations. No TMDB or Supabase I/O happens here, so the model call gets
 * the function's full time budget. Falls back to popularity ordering if the LLM
 * call fails, so the user still gets results.
 */
export async function POST(req: Request) {
  try {
    const body: RecommendBody = await req.json().catch(() => ({}));
    const { profile, candidates } = body;

    if (!profile || typeof profile !== "object") {
      return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    let picks: Pick[];
    try {
      // Cap below the 60s platform limit so a hung model trips the fallback
      // rather than letting the platform kill the function (504).
      picks = await withTimeout(
        selectRecommendations(
          profile,
          candidates,
          body.dislikedTitles ?? [],
          body.likedTitles ?? [],
          body.watchedTitles ?? [],
          body.watchlistTitles ?? [],
        ),
        50000,
        "selectRecommendations (Anthropic)",
      );
    } catch (err) {
      console.error("[/api/recommend] LLM selection failed, falling back to popularity:", err);
      picks = [...candidates]
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 15)
        .map((c) => ({
          id: c.id,
          mediaType: c.mediaType,
          whyThisFits: "Popular right now",
          vibeCheck: "Trending",
        }));
    }

    // Drop any pick the model invented that isn't in the real pool.
    const validKeys = new Set(candidates.map((c) => `${c.mediaType}:${c.id}`));
    const valid = picks.filter((p) => validKeys.has(`${p.mediaType}:${p.id}`));

    // Map picks to recommendations using candidate data (no enrichment here —
    // providers/reviews/screenshots are fetched client-side or in background).
    const recommendations: Recommendation[] = [];
    for (const pick of valid) {
      const candidate = candidates.find(
        (c) => c.id === pick.id && c.mediaType === pick.mediaType,
      );
      if (!candidate) continue;
      recommendations.push({
        id: candidate.id,
        mediaType: candidate.mediaType,
        title: candidate.title,
        year: candidate.year,
        description: candidate.overview,
        rating: candidate.rating,
        voteCount: 0,
        screenshotUrl: candidate.screenshotUrl,
        posterUrl: candidate.posterUrl,
        providers: [],
        reviews: [],
        whyThisFits: pick.whyThisFits,
        vibeCheck: pick.vibeCheck,
      });
    }

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
