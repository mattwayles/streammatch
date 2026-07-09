"use client";

import { useState } from "react";
import Link from "next/link";
import Hero from "@/components/Hero";
import QuestionCard from "@/components/QuestionCard";
import Loader from "@/components/Loader";
import ResultCard from "@/components/ResultCard";
import RotatingMessage from "@/components/RotatingMessage";
import { ToastStack, useToasts } from "@/components/Toast";
import { INTERVIEW_PHRASES } from "@/lib/phrases";
import type {
  InterviewStep,
  InterviewTurn,
  MoodProfile,
  Question,
  Recommendation,
} from "@/lib/types";

type Phase = "landing" | "interview" | "loading" | "results" | "error";

// Mood seeds for "Surprise me" — spread across genres/moods so repeated presses
// feel genuinely different. Each is run through the same free-text -> profile ->
// curation pipeline.
const SURPRISE_SEEDS = [
  "Surprise me with the buzziest thing streaming right now.",
  "Pick a hidden gem most people missed — your bold wildcard.",
  "Give me a cozy, feel-good comfort watch for tonight.",
  "I want an edge-of-my-seat thriller — you choose.",
  "Hit me with a mind-bending sci-fi pick.",
  "Choose a critically acclaimed recent drama for me.",
  "Something fun and mindless to switch my brain off.",
  "A gripping true-crime story — your pick.",
  "Surprise me with a great recent comedy.",
  "Your boldest, most unexpected recommendation tonight.",
  "A heartwarming animated movie the whole room would enjoy.",
  "Something dark, atmospheric, and a little unsettling.",
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [history, setHistory] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { toasts, notify } = useToasts();

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
      // Step 1: build the candidate pool + taste context (TMDB + Supabase).
      const candRes = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const candData = (await candRes.json()) as
        | {
            candidates: unknown[];
            watchlistEmpty?: boolean;
            dislikedTitles: string[];
            likedTitles: string[];
            watchlistTitles: string[];
          }
        | { error: string };
      if (!candRes.ok || "error" in candData) {
        throw new Error(
          "error" in candData ? candData.error : "Failed to load candidates",
        );
      }
      if (candData.watchlistEmpty) {
        throw new Error(
          "Your watch list is empty. Add titles with the 🔖 Watch Later button first.",
        );
      }
      if (!candData.candidates.length) {
        setRecs([]);
        setPhase("results");
        return;
      }

      // Step 2: LLM curation, streamed. The endpoint returns newline-delimited
      // JSON — one recommendation per pick as the model produces it — so cards
      // render incrementally and a large result set never has to fit inside a
      // single response within the time budget.
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, ...candData }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? "Recommendation request failed");
      }
      if (!res.body) throw new Error("Recommendation stream was empty");

      setRecs([]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg: { type: string; rec?: Recommendation };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (msg.type === "rec" && msg.rec) {
          if (!started) {
            started = true;
            setPhase("results");
          }
          setRecs((prev) => [...prev, msg.rec as Recommendation]);
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            handleLine(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
          }
        }
        handleLine(buffer);
      } catch (streamErr) {
        // Once cards are on screen, keep the partial set rather than wiping it
        // out with an error screen; only surface failures that happened before
        // anything rendered.
        if (!started) throw streamErr;
        console.error("[curate] stream interrupted after partial results:", streamErr);
      }

      // No results streamed (empty pool, or an early failure) — still land on
      // the results view rather than hanging on the loader.
      if (!started) setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }

  // Default path: user types what they want in natural language. Translate it
  // to a mood profile, then run the same candidate + curation pipeline.
  async function quickSearch(text: string) {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as
        | { profile: MoodProfile }
        | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Couldn't understand that");
      }
      await curate(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }

  // "Surprise me" — pick a random mood seed and let the LLM curate from it, so
  // each press lands on a different corner of what's streaming.
  function surpriseMe() {
    const seed = SURPRISE_SEEDS[Math.floor(Math.random() * SURPRISE_SEEDS.length)];
    quickSearch(seed);
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

  const markDisliked = (rec: Recommendation) => hideAndPost(rec, "/api/disliked");
  const markLiked = (rec: Recommendation) => hideAndPost(rec, "/api/liked");

  async function addToWatchlist(rec: Recommendation) {
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: rec.id,
          mediaType: rec.mediaType,
          title: rec.title,
          // Extra metadata so the item renders fully when mirrored to Nuvio.
          poster: rec.posterUrl,
          background: rec.screenshotUrl,
          description: rec.description,
          year: rec.year,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      notify(
        data.nuvio === "synced"
          ? `🔖 "${rec.title}" added to your watchlist and synced to Nuvio`
          : data.nuvio === "failed"
            ? `🔖 "${rec.title}" added to your watchlist (Nuvio sync failed)`
            : `🔖 "${rec.title}" added to your watchlist`,
      );
    } catch (e) {
      notify(
        `Couldn't add "${rec.title}" to your watchlist — ${
          e instanceof Error ? e.message : "please try again"
        }`,
        "error",
      );
    }
  }

  function reset() {
    setPhase("landing");
    setHistory([]);
    setQuestion(null);
    setRecs([]);
    setError(null);
  }

  if (phase === "landing")
    return <Hero onSearch={quickSearch} onRandom={surpriseMe} onStart={start} />;

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
      <ToastStack toasts={toasts} />
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
