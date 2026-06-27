"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ListItem } from "@/lib/supabase";

type Kind = "disliked" | "watchlist" | "liked";

const ENDPOINT: Record<Kind, string> = {
  disliked: "/api/disliked",
  watchlist: "/api/watchlist",
  liked: "/api/liked",
};

function Section({
  kind,
  title,
  subtitle,
  emptyText,
  removeLabel = "↺ Re-enable",
}: {
  kind: Kind;
  title: string;
  subtitle: string;
  emptyText: string;
  removeLabel?: string;
}) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(ENDPOINT[kind]);
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
  }, [kind]);

  const reEnable = useCallback(
    async (item: ListItem) => {
      const key = `${item.mediaType}:${item.tmdbId}`;
      setPending(key);
      const prev = items;
      setItems((list) =>
        list.filter((i) => !(i.tmdbId === item.tmdbId && i.mediaType === item.mediaType)),
      );
      try {
        const res = await fetch(ENDPOINT[kind], {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId: item.tmdbId, mediaType: item.mediaType }),
        });
        if (!res.ok) throw new Error();
      } catch {
        setItems(prev);
      } finally {
        setPending(null);
      }
    },
    [items, kind],
  );

  return (
    <section className="mb-12">
      <h2 className="font-display text-2xl font-semibold text-white">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-white/50">{subtitle}</p>

      {loading ? (
        <p className="animate-pulse-glow text-white/40">Loading…</p>
      ) : error ? (
        <div className="glass rounded-2xl p-6 text-center text-white/70">{error}</div>
      ) : !configured ? (
        <div className="glass rounded-2xl p-6 text-center text-white/70">
          Not configured (Supabase keys missing).
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-white/60">{emptyText}</div>
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
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => reEnable(item)}
                  disabled={pending === key}
                  className="glass glass-hover shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-glow-soft disabled:opacity-40"
                >
                  {removeLabel}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function LibraryPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-glow-soft">
            Your memory
          </p>
          <h1 className="font-display text-4xl font-bold text-glow sm:text-5xl">
            Your library
          </h1>
          <p className="mt-2 text-sm text-white/60">
            Hidden from suggestions. Re-enable anything to bring it back.
          </p>
        </div>
        <Link
          href="/"
          className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
        >
          ← Back
        </Link>
      </div>

      <Section
        kind="watchlist"
        title="🔖 Watch List"
        subtitle="Titles you've saved to watch later. Pick 'Something from my watch list' at the start to surface these."
        emptyText="Nothing saved to your watch list yet."
        removeLabel="✕ Remove"
      />
      <Section
        kind="liked"
        title="👍 Liked"
        subtitle="Titles you've loved — used as a positive taste signal to refine future recommendations."
        emptyText="Nothing liked yet."
      />
      <Section
        kind="disliked"
        title="👎 Disliked"
        subtitle="Titles you've passed on — future suggestions steer away from these and anything similar."
        emptyText="Nothing disliked yet."
      />
    </main>
  );
}
