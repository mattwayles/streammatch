import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "./types";

const TABLES = {
  watched: "streammatch_watched",
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
export function watchedKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export interface ListItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  createdAt: string;
}
// Back-compat alias.
export type WatchedItem = ListItem;

// ---------------------------------------------------------------------------
// Generic core — one implementation, two lists (watched / disliked).
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
  const { data, error } = await c
    .from(TABLES[kind])
    .select("tmdb_id, media_type, title, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(`[supabase] list(${kind}):`, error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    tmdbId: r.tmdb_id as number,
    mediaType: r.media_type as MediaType,
    title: (r.title as string) ?? "",
    createdAt: r.created_at as string,
  }));
}

async function mark(
  kind: ListKind,
  tmdbId: number,
  mediaType: MediaType,
  title: string,
): Promise<void> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const { error } = await c
    .from(TABLES[kind])
    .upsert(
      { tmdb_id: tmdbId, media_type: mediaType, title },
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
// Watched
// ---------------------------------------------------------------------------

export const getWatchedKeys = () => getKeys("watched");
export const listWatched = () => list("watched");
export const markWatched = (tmdbId: number, mediaType: MediaType, title: string) =>
  mark("watched", tmdbId, mediaType, title);
export const unmarkWatched = (tmdbId: number, mediaType: MediaType) =>
  unmark("watched", tmdbId, mediaType);

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
export const markWatchlist = (tmdbId: number, mediaType: MediaType, title: string) =>
  mark("watchlist", tmdbId, mediaType, title);
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
