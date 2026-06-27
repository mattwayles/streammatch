import { NextResponse } from "next/server";
import { streamSelections } from "@/lib/anthropic";
import type { Candidate, Pick } from "@/lib/anthropic";
import type { MoodProfile, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Stop the model stream a few seconds under the platform limit so we always
// finish (emit "done" / fall back) before the function is killed.
const SELECTION_DEADLINE_MS = 52000;

interface RecommendBody {
  profile?: MoodProfile;
  candidates?: Candidate[];
  dislikedTitles?: string[];
  likedTitles?: string[];
  watchedTitles?: string[];
  watchlistTitles?: string[];
}

function toRecommendation(candidate: Candidate, pick: Pick): Recommendation {
  return {
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
  };
}

/**
 * Pure LLM curation, streamed. Receives a pre-built candidate pool + taste
 * context from /api/candidates and streams newline-delimited JSON back to the
 * client — one `{type:"rec", rec}` per pick as the model produces it, then a
 * final `{type:"done"}`. Because cards render as they arrive, a large result set
 * never has to fit inside a single response within the time budget. If the model
 * produces nothing, falls back to popularity ordering so the user still gets
 * results.
 */
export async function POST(req: Request) {
  const body: RecommendBody = await req.json().catch(() => ({}));
  const { profile, candidates } = body;

  if (!profile || typeof profile !== "object") {
    return NextResponse.json({ error: "Missing mood profile" }, { status: 400 });
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return NextResponse.json({ error: "No candidates provided" }, { status: 400 });
  }

  // Index candidates for O(1) lookup and to drop any pick the model invents.
  const byKey = new Map(candidates.map((c) => [`${c.mediaType}:${c.id}`, c]));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const seen = new Set<string>();
      let emitted = 0;

      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const emitPick = (pick: Pick) => {
        const key = `${pick.mediaType}:${pick.id}`;
        const candidate = byKey.get(key);
        if (!candidate || seen.has(key)) return;
        seen.add(key);
        emit({ type: "rec", rec: toRecommendation(candidate, pick) });
        emitted++;
      };

      try {
        await streamSelections(
          profile,
          candidates,
          body.dislikedTitles ?? [],
          body.likedTitles ?? [],
          body.watchedTitles ?? [],
          body.watchlistTitles ?? [],
          emitPick,
          SELECTION_DEADLINE_MS,
        );
      } catch (err) {
        console.error("[/api/recommend] selection stream failed:", err);
      }

      // Nothing usable from the model — fall back to popularity so the user
      // still gets a full set of results.
      if (emitted === 0) {
        const fallback = [...candidates]
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 60);
        for (const c of fallback) {
          emitPick({
            id: c.id,
            mediaType: c.mediaType,
            whyThisFits: "Popular right now",
            vibeCheck: "Trending",
          });
        }
      }

      emit({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Hint to proxies not to buffer, so chunks reach the client as they flush.
      "X-Accel-Buffering": "no",
    },
  });
}
