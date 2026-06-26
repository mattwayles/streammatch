"use client";

import Link from "next/link";

export default function Hero({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="animate-fade-up">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-glow-soft">
          Your entertainment concierge
        </p>
        <h1 className="font-display text-6xl font-bold leading-tight text-glow sm:text-7xl">
          Stream<span className="text-glow-soft">Match</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          Tell me how you feel <span className="text-white">right now</span> — and I&apos;ll
          match you to the newest, most-loved thing to watch tonight, across every major
          platform.
        </p>
        <button
          onClick={onStart}
          className="btn-glow mt-10 rounded-full px-10 py-4 text-base font-semibold"
        >
          Find tonight&apos;s watch →
        </button>
        <p className="mt-6 text-xs text-white/40">
          A few quick questions. No sign-up.
        </p>
        <Link
          href="/watched"
          className="mt-4 inline-block text-sm font-medium text-glow-soft hover:underline"
        >
          View your watched library →
        </Link>
      </div>
    </div>
  );
}
