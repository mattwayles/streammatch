"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WatchedItem } from "@/lib/supabase";

export default function WatchedPage() {
  const [items, setItems] = useState<WatchedItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watched");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setItems(data.items ?? []);
        setConfigured(data.configured ?? true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function reEnable(item: WatchedItem) {
    const key = `${item.mediaType}:${item.tmdbId}`;
    setPending(key);
    const prev = items;
    setItems((list) =>
      list.filter((i) => !(i.tmdbId === item.tmdbId && i.mediaType === item.mediaType)),
    );
    try {
      const res = await fetch("/api/watched", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: item.tmdbId, mediaType: item.mediaType }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev); // restore on failure
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-glow-soft">
            Your memory
          </p>
          <h1 className="font-display text-4xl font-bold text-glow sm:text-5xl">
            Watched library
          </h1>
          <p className="mt-2 text-sm text-white/60">
            These are hidden from suggestions. Re-enable any to let it come back.
          </p>
        </div>
        <Link
          href="/"
          className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
        >
          ← Back
        </Link>
      </div>

      {loading ? (
        <p className="animate-pulse-glow text-white/50">Loading…</p>
      ) : error ? (
        <div className="glass rounded-3xl p-8 text-center text-white/70">{error}</div>
      ) : !configured ? (
        <div className="glass rounded-3xl p-8 text-center text-white/70">
          The watched memory isn&apos;t configured (Supabase keys missing).
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-3xl p-10 text-center">
          <p className="text-white/70">Nothing marked watched yet.</p>
          <Link
            href="/"
            className="btn-glow mt-6 inline-block rounded-full px-8 py-3 text-sm font-semibold"
          >
            Find something to watch →
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const key = `${item.mediaType}:${item.tmdbId}`;
            return (
              <li
                key={key}
                className="glass flex items-center justify-between gap-4 rounded-2xl px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-glow/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {item.mediaType === "tv" ? "TV" : "Movie"}
                    </span>
                    <span className="truncate font-medium">
                      {item.title || `TMDB #${item.tmdbId}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">
                    Marked {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => reEnable(item)}
                  disabled={pending === key}
                  className="glass glass-hover shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-glow-soft disabled:opacity-40"
                >
                  ↺ Re-enable
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
