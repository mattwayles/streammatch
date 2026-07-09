"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ResultCard from "@/components/ResultCard";
import type { Recommendation, SearchResult } from "@/lib/types";

const DEBOUNCE_MS = 400;

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideWatchlist, setHideWatchlist] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch — empty query browses the most popular titles.
  useEffect(() => {
    const timer = setTimeout(
      async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
            signal: controller.signal,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Search failed");
          setItems(data.items ?? []);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : "Search failed");
        } finally {
          if (abortRef.current === controller) setLoading(false);
        }
      },
      query.trim() ? DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const removeItem = (rec: Recommendation) =>
    setItems((prev) =>
      prev.filter((i) => !(i.id === rec.id && i.mediaType === rec.mediaType)),
    );

  async function hideAndPost(rec: Recommendation, endpoint: string) {
    removeItem(rec);
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: rec.id, mediaType: rec.mediaType, title: rec.title }),
      });
    } catch {
      // Non-fatal: it's hidden locally even if persistence failed.
    }
  }

  async function addToWatchlist(rec: Recommendation) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === rec.id && i.mediaType === rec.mediaType ? { ...i, inWatchlist: true } : i,
      ),
    );
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: rec.id,
          mediaType: rec.mediaType,
          title: rec.title,
          poster: rec.posterUrl,
          background: rec.screenshotUrl,
          description: rec.description,
          year: rec.year,
        }),
      });
    } catch {
      // Non-fatal.
    }
  }

  const visible = hideWatchlist ? items.filter((i) => !i.inWatchlist) : items;
  const searching = query.trim().length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-glow-soft">
            Browse the catalog
          </p>
          <h1 className="font-display text-4xl font-bold text-glow sm:text-5xl">
            Search for anything
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/watched"
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            ★ Your library
          </Link>
          <Link
            href="/"
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            ← Home
          </Link>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search movies and shows…"
          className="glass min-w-64 flex-1 rounded-full px-6 py-4 text-base text-white placeholder-white/40 outline-none transition focus:ring-2 focus:ring-white/25"
        />
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={hideWatchlist}
            onChange={(e) => setHideWatchlist(e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          Hide Watchlist
        </label>
      </div>

      <p className="mb-6 text-sm text-white/50">
        {searching
          ? "Matches and related picks you may like"
          : "Most popular right now"}
      </p>

      {loading ? (
        <p className="animate-pulse-glow text-white/40">
          {searching ? "Searching…" : "Loading…"}
        </p>
      ) : error ? (
        <div className="glass rounded-3xl p-12 text-center text-white/70">{error}</div>
      ) : visible.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <p className="text-white/70">
            {items.length > 0
              ? "Everything matching is already on your watchlist."
              : "No matches found. Try a different title."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {visible.map((item) => (
            <ResultCard
              key={`${item.mediaType}-${item.id}`}
              rec={item.related ? { ...item, vibeCheck: "Related pick" } : item}
              inWatchlist={item.inWatchlist}
              onDisliked={(rec) => hideAndPost(rec, "/api/disliked")}
              onLiked={(rec) => hideAndPost(rec, "/api/liked")}
              onWatchlist={addToWatchlist}
            />
          ))}
        </div>
      )}
    </main>
  );
}
