import { NextResponse } from "next/server";
import { nextInterviewStep } from "@/lib/anthropic";
import type { InterviewTurn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const history: InterviewTurn[] = Array.isArray(body?.history) ? body.history : [];
    const step = await nextInterviewStep(history);
    return NextResponse.json(step);
  } catch (err) {
    console.error("[/api/interview]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Interview failed: ${message}` },
      { status: 500 },
    );
  }
}
