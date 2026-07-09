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

function useList(kind: Kind) {
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

  const remove = useCallback(
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

  return { items, configured, loading, error, pending, remove };
}

function StatusPanel({
  loading,
  error,
  configured,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  configured: boolean;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) return <p className="animate-pulse-glow text-white/40">Loading…</p>;
  if (error) return <div className="glass rounded-2xl p-6 text-center text-white/70">{error}</div>;
  if (!configured)
    return (
      <div className="glass rounded-2xl p-6 text-center text-white/70">
        Not configured (Supabase keys missing).
      </div>
    );
  if (empty)
    return <div className="glass rounded-2xl p-8 text-center text-white/60">{emptyText}</div>;
  return null;
}

/** Watchlist rendered as a grid of poster thumbnails. */
function WatchlistGrid() {
  const { items, configured, loading, error, pending, remove } = useList("watchlist");

  return (
    <section className="mb-12">
      <h2 className="font-display text-2xl font-semibold text-white">🔖 Watch List</h2>
      <p className="mb-4 mt-1 text-sm text-white/50">
        Titles you&apos;ve saved to watch later. Pick &lsquo;Something from my watch list&rsquo; at
        the start to surface these.
      </p>

      <StatusPanel
        loading={loading}
        error={error}
        configured={configured}
        empty={items.length === 0}
        emptyText="Nothing saved to your watch list yet."
      />

      {!loading && !error && configured && items.length > 0 && (
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
          {items.map((item) => {
            const key = `${item.mediaType}:${item.tmdbId}`;
            return (
              <li key={key} className="group">
                <div className="glass relative aspect-[2/3] overflow-hidden rounded-2xl">
                  {item.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.posterUrl}
                      alt={item.title || `TMDB #${item.tmdbId}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3 text-center text-xs text-white/60">
                      {item.title || `TMDB #${item.tmdbId}`}
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {item.mediaType === "tv" ? "TV" : "Movie"}
                  </span>
                  <button
                    onClick={() => remove(item)}
                    disabled={pending === key}
                    aria-label={`Remove ${item.title || `TMDB #${item.tmdbId}`}`}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-xs text-white/80 opacity-100 transition hover:bg-black/90 hover:text-white disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  >
                    ✕
                  </button>
                </div>
                <p className="mt-2 truncate text-xs text-white/70" title={item.title}>
                  {item.title || `TMDB #${item.tmdbId}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Liked/Disliked rendered as the original row list, inside a collapsed-by-default container. */
function CollapsibleListSection({
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
  const { items, configured, loading, error, pending, remove } = useList(kind);
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-6">
      <div className="glass rounded-2xl">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold text-white">
              {title}
              {!loading && (
                <span className="ml-2 align-middle text-sm font-normal text-white/40">
                  {items.length}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-white/50">{subtitle}</p>
          </div>
          <span
            aria-hidden
            className={`shrink-0 text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>

        {open && (
          <div className="px-5 pb-5">
            <StatusPanel
              loading={loading}
              error={error}
              configured={configured}
              empty={items.length === 0}
              emptyText={emptyText}
            />
            {!loading && !error && configured && items.length > 0 && (
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
                        onClick={() => remove(item)}
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
          </div>
        )}
      </div>
    </section>
  );
}

function NuvioSync({ onSynced }: { onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        setEnabled(
          Boolean(data.nuvioConfigured) && data.settings?.nuvio_sync_enabled !== false,
        );
      } catch {
        // Leave the button hidden; the API enforces the setting regardless.
      }
    })();
  }, []);

  async function sync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/nuvio/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const parts = [
        data.library?.added > 0 ? `${data.library.added} to your watch list` : null,
        data.watched?.added > 0 ? `${data.watched.added} watched title${data.watched.added === 1 ? "" : "s"} to liked` : null,
      ].filter(Boolean);
      setMessage(parts.length ? `Added ${parts.join(" · ")} from Nuvio` : "Already up to date");
      if (parts.length) onSynced();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={sync}
        disabled={syncing}
        className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold text-glow-soft disabled:opacity-40"
      >
        {syncing ? "Syncing…" : "⟳ Sync with Nuvio"}
      </button>
      {message && <p className="max-w-56 text-right text-xs text-white/50">{message}</p>}
    </div>
  );
}

export default function LibraryPage() {
  // Bumped after a Nuvio sync adds titles — remounts the affected sections so
  // they refetch (sync inserts into both the watchlist and the liked list).
  const [syncVersion, setSyncVersion] = useState(0);

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
        <div className="flex flex-wrap items-center gap-3">
          <NuvioSync onSynced={() => setSyncVersion((v) => v + 1)} />
          <Link
            href="/"
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            ← Back
          </Link>
        </div>
      </div>

      <WatchlistGrid key={`watchlist-${syncVersion}`} />

      <CollapsibleListSection
        key={`liked-${syncVersion}`}
        kind="liked"
        title="👍 Liked"
        subtitle="Titles you've loved — used as a positive taste signal to refine future recommendations."
        emptyText="Nothing liked yet."
      />
      <CollapsibleListSection
        kind="disliked"
        title="👎 Disliked"
        subtitle="Titles you've passed on — future suggestions steer away from these and anything similar."
        emptyText="Nothing disliked yet."
      />
    </main>
  );
}
