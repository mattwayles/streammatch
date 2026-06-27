"use client";

import { useState } from "react";
import Link from "next/link";

export default function Hero({
  onSearch,
  onStart,
}: {
  onSearch: (text: string) => void;
  onStart: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed) onSearch(trimmed);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-2xl animate-fade-up">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-glow-soft">
          Your entertainment concierge
        </p>
        <h1 className="font-display text-6xl font-bold leading-tight text-glow sm:text-7xl">
          Stream<span className="text-glow-soft">Match</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          What are you feeling <span className="text-white">tonight</span>?
        </p>

        <form onSubmit={submit} className="mt-8">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter for a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (trimmed) onSearch(trimmed);
              }
            }}
            rows={3}
            autoFocus
            placeholder="e.g. a cozy feel-good comedy series, a tense true-crime doc, a mind-bending sci-fi movie… or just 'surprise me'"
            className="glass w-full resize-none rounded-2xl px-5 py-4 text-left text-base text-white placeholder-white/40 outline-none transition focus:ring-2 focus:ring-white/25"
          />
          <button
            type="submit"
            disabled={!trimmed}
            className="btn-glow mt-5 w-full rounded-full px-10 py-4 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            Find my watch →
          </button>
        </form>

        <button
          onClick={onStart}
          className="glass glass-hover mt-4 rounded-full px-8 py-3 text-sm font-semibold"
        >
          I don&apos;t know, grill me
        </button>

        <p className="mt-6 text-xs text-white/40">No sign-up. Just vibes.</p>
        <Link
          href="/watched"
          className="mt-4 inline-block text-sm font-medium text-glow-soft hover:underline"
        >
          View your library →
        </Link>
      </div>
    </div>
  );
}
