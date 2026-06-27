import { NextResponse } from "next/server";
import { profileFromText } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Translate a free-text "what are you feeling tonight?" request into a
 * MoodProfile, so the user can skip the interview entirely. The returned
 * profile feeds the same /api/candidates -> /api/recommend pipeline.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "Tell me what you're in the mood for." },
        { status: 400 },
      );
    }

    const profile = await profileFromText(text.slice(0, 2000));
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[/api/profile]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't read that: ${message}` },
      { status: 500 },
    );
  }
}
