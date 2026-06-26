import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "./types";

const TABLE = "streammatch_watched";

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

export function watchedKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** All watched titles as a Set of "mediaType:tmdbId" keys. Empty if unconfigured. */
export async function getWatchedKeys(): Promise<Set<string>> {
  const c = client();
  if (!c) return new Set();
  const { data, error } = await c.from(TABLE).select("tmdb_id, media_type");
  if (error) {
    console.error("[supabase] getWatchedKeys:", error.message);
    return new Set();
  }
  return new Set(
    (data ?? []).map((r) => `${r.media_type}:${r.tmdb_id}` as string),
  );
}

export interface WatchedItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  createdAt: string;
}

/** Full watched list, newest first. Empty if unconfigured. */
export async function listWatched(): Promise<WatchedItem[]> {
  const c = client();
  if (!c) return [];
  const { data, error } = await c
    .from(TABLE)
    .select("tmdb_id, media_type, title, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] listWatched:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    tmdbId: r.tmdb_id as number,
    mediaType: r.media_type as MediaType,
    title: (r.title as string) ?? "",
    createdAt: r.created_at as string,
  }));
}

/** Remove a title from the watched list (re-enables it for recommendations). */
export async function unmarkWatched(tmdbId: number, mediaType: MediaType): Promise<void> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const { error } = await c
    .from(TABLE)
    .delete()
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);
  if (error) throw new Error(error.message);
}

/** Mark a title watched (idempotent — duplicates are ignored). */
export async function markWatched(
  tmdbId: number,
  mediaType: MediaType,
  title: string,
): Promise<void> {
  const c = client();
  if (!c) throw new Error("Supabase is not configured");
  const { error } = await c
    .from(TABLE)
    .upsert(
      { tmdb_id: tmdbId, media_type: mediaType, title },
      { onConflict: "tmdb_id,media_type", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}
