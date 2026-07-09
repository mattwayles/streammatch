import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "./types";

const TABLES = {
  disliked: "streammatch_disliked",
  watchlist: "streammatch_watchlist",
  liked: "streammatch_liked",
} as const;
type ListKind = keyof typeof TABLES;

let _client: SupabaseClient | null = null;

/**
 * Server-side Supabase client (anon key + RLS). Returns null when Supabase isn't
 * configured so the app degrades gracefully instead of crashing.
 */
function client(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export function isConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** "mediaType:tmdbId" key used for set membership / exclusion. */
export function itemKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export interface ListItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  /** Full poster image URL. Only populated for the watchlist. */
  posterUrl: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Generic core — one implementation across the disliked / liked / watchlist lists.
// ---------------------------------------------------------------------------

async function getKeys(kind: ListKind): Promise<Set<string>> {
  const c = client();
  if (!c) return new Set();
  const { data, error } = await c.from(TABLES[kind]).select("tmdb_id, media_type");
  if (error) {
    console.error(`[supabase] getKeys(${kind}):`, error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => `${r.media_type}:${r.tmdb_id}` as string));
}

async function list(kind: ListKind): Promise<ListItem[]> {
  const c = client();
  if (!c) return [];
  // Only the watchlist table has a poster column. Retry without it so the
  // page still works if the schema upgrade hasn't been applied yet.
  let query = kind === "watchlist" ? "tmdb_id, media_type, title, poster, created_at"
    : "tmdb_id, media_type, title, created_at";
  let { data, error } = await c
    .from(TABLES[kind])
    .select(query)
    .order("created_at", { ascending: false });
  if (error && kind === "watchlist") {
    query = "tmdb_id, media_type, title, created_at";
    ({ data, error } = await c
      .from(TABLES[kind])
      .select(query)
      .order("created_at", { ascending: false }));
  }
  if (error) {
    console.error(`[supabase] list(${kind}):`, error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    tmdbId: r.tmdb_id as number,
    mediaType: r.media_type as MediaType,
    title: (r.title as string) ?? "",
    posterUrl: (r.poster as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

async function mark(
  kind: ListKind,
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  poster?: string | null,
): Promise<void> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const row: Record<string, unknown> = { tmdb_id: tmdbId, media_type: mediaType, title };
  if (poster !== undefined) row.poster = poster;
  const { error } = await c
    .from(TABLES[kind])
    .upsert(row, { onConflict: "tmdb_id,media_type", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function markMany(
  kind: ListKind,
  items: { tmdbId: number; mediaType: MediaType; title: string; poster?: string | null }[],
): Promise<void> {
  if (items.length === 0) return;
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const withPoster = kind === "watchlist";
  const { error } = await c
    .from(TABLES[kind])
    .upsert(
      items.map((i) => ({
        tmdb_id: i.tmdbId,
        media_type: i.mediaType,
        title: i.title,
        ...(withPoster ? { poster: i.poster ?? null } : {}),
      })),
      { onConflict: "tmdb_id,media_type", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

async function unmark(kind: ListKind, tmdbId: number, mediaType: MediaType): Promise<void> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const { error } = await c
    .from(TABLES[kind])
    .delete()
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Disliked
// ---------------------------------------------------------------------------

export const getDislikedKeys = () => getKeys("disliked");
export const listDisliked = () => list("disliked");
export const markDisliked = (tmdbId: number, mediaType: MediaType, title: string) =>
  mark("disliked", tmdbId, mediaType, title);
export const unmarkDisliked = (tmdbId: number, mediaType: MediaType) =>
  unmark("disliked", tmdbId, mediaType);

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export const getWatchlistKeys = () => getKeys("watchlist");
export const listWatchlist = () => list("watchlist");
export const markWatchlist = (
  tmdbId: number,
  mediaType: MediaType,
  title: string,
  poster?: string | null,
) => mark("watchlist", tmdbId, mediaType, title, poster);
export const markWatchlistMany = (
  items: { tmdbId: number; mediaType: MediaType; title: string; poster?: string | null }[],
) => markMany("watchlist", items);

/**
 * Backfill poster art onto existing watchlist rows. Upsert only touches the
 * columns provided, so titles are preserved. Best-effort: callers should not
 * fail the request if this write is rejected (e.g. schema not yet upgraded).
 */
export async function updateWatchlistPosters(
  items: { tmdbId: number; mediaType: MediaType; poster: string }[],
): Promise<void> {
  if (items.length === 0) return;
  const c = client();
  if (!c) return;
  const { error } = await c
    .from(TABLES.watchlist)
    .upsert(
      items.map((i) => ({ tmdb_id: i.tmdbId, media_type: i.mediaType, poster: i.poster })),
      { onConflict: "tmdb_id,media_type" },
    );
  if (error) console.error("[supabase] updateWatchlistPosters:", error.message);
}
export const unmarkWatchlist = (tmdbId: number, mediaType: MediaType) =>
  unmark("watchlist", tmdbId, mediaType);

// ---------------------------------------------------------------------------
// Liked
// ---------------------------------------------------------------------------

export const getLikedKeys = () => getKeys("liked");
export const listLiked = () => list("liked");
export const markLiked = (tmdbId: number, mediaType: MediaType, title: string) =>
  mark("liked", tmdbId, mediaType, title);
export const unmarkLiked = (tmdbId: number, mediaType: MediaType) =>
  unmark("liked", tmdbId, mediaType);
