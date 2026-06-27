"use client";

import { useState } from "react";
import Link from "next/link";
import Hero from "@/components/Hero";
import QuestionCard from "@/components/QuestionCard";
import Loader from "@/components/Loader";
import ResultCard from "@/components/ResultCard";
import RotatingMessage from "@/components/RotatingMessage";
import { INTERVIEW_PHRASES } from "@/lib/phrases";
import type {
  InterviewStep,
  InterviewTurn,
  MoodProfile,
  Question,
  Recommendation,
} from "@/lib/types";

type Phase = "landing" | "interview" | "loading" | "results" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [history, setHistory] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function fetchStep(nextHistory: InterviewTurn[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: nextHistory }),
      });
      const data = (await res.json()) as InterviewStep | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Interview request failed");
      }
      if (data.kind === "question") {
        setQuestion(data.question);
      } else {
        await curate(data.profile);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  async function curate(profile: MoodProfile) {
    setPhase("loading");
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = (await res.json()) as
        | { recommendations: Recommendation[]; watchlistEmpty?: boolean }
        | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Recommendation request failed");
      }
      if ("watchlistEmpty" in data && data.watchlistEmpty) {
        throw new Error(
          "Your watch list is empty. Add titles with the 🔖 Watch Later button first.",
        );
      }
      setRecs(data.recommendations);
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }

  function start() {
    setHistory([]);
    setQuestion(null);
    setRecs([]);
    setError(null);
    setPhase("interview");
    fetchStep([]);
  }

  function answer(value: string) {
    if (busy || !question) return;
    const next = [...history, { question: question.text, answer: value }];
    setHistory(next);
    setQuestion(null);
    fetchStep(next);
  }

  async function hideAndPost(rec: Recommendation, endpoint: string) {
    // Optimistically hide it from the current results.
    setRecs((prev) =>
      prev.filter((r) => !(r.id === rec.id && r.mediaType === rec.mediaType)),
    );
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: rec.id,
          mediaType: rec.mediaType,
          title: rec.title,
        }),
      });
    } catch {
      // Non-fatal: it's hidden locally even if persistence failed.
    }
  }

  const markWatched = (rec: Recommendation) => hideAndPost(rec, "/api/watched");
  const markDisliked = (rec: Recommendation) => hideAndPost(rec, "/api/disliked");
  const markLiked = (rec: Recommendation) => hideAndPost(rec, "/api/liked");

  async function addToWatchlist(rec: Recommendation) {
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: rec.id, mediaType: rec.mediaType, title: rec.title }),
      });
    } catch {
      // Non-fatal.
    }
  }

  function reset() {
    setPhase("landing");
    setHistory([]);
    setQuestion(null);
    setRecs([]);
    setError(null);
  }

  if (phase === "landing") return <Hero onStart={start} />;

  if (phase === "loading") return <Loader />;

  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 font-display text-3xl text-glow">Something went sideways</p>
        <p className="mb-8 max-w-md text-sm text-white/60">{error}</p>
        <button onClick={reset} className="btn-glow rounded-full px-8 py-3 font-semibold">
          Start over
        </button>
      </div>
    );
  }

  if (phase === "interview") {
    if (!question) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <RotatingMessage
            messages={INTERVIEW_PHRASES}
            className="animate-pulse-glow font-display text-2xl text-glow"
          />
        </div>
      );
    }
    return (
      <main className="flex min-h-screen items-center justify-center">
        <QuestionCard
          key={history.length}
          question={question}
          questionNumber={history.length + 1}
          busy={busy}
          onAnswer={answer}
        />
      </main>
    );
  }

  // results
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-glow-soft">
            Tonight&apos;s matches
          </p>
          <h1 className="font-display text-4xl font-bold text-glow sm:text-5xl">
            Curated for your mood
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/watched"
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            ★ Your library
          </Link>
          <button
            onClick={reset}
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            ↺ Start over
          </button>
        </div>
      </div>

      {recs.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <p className="mb-4 text-white/70">
            Couldn&apos;t find a confident match for that exact mood right now.
          </p>
          <button
            onClick={reset}
            className="btn-glow rounded-full px-8 py-3 font-semibold"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {recs.map((rec) => (
            <ResultCard
              key={`${rec.mediaType}-${rec.id}`}
              rec={rec}
              onWatched={markWatched}
              onDisliked={markDisliked}
              onLiked={markLiked}
              onWatchlist={addToWatchlist}
            />
          ))}
        </div>
      )}
    </main>
  );
}
