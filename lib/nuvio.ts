import { getAppSettings } from "./supabase";
import type { MediaType } from "./types";

// Nuvio Public API (https://nuvioapp.space/docs) — Supabase-backed REST/RPC.
// StreamMatch signs in with the account's email/password and syncs the
// bookmarked "library" against the local watchlist.
const BASE = process.env.NUVIO_API_URL || "https://api.nuvio.tv";
const PUBLISHABLE_KEY =
  process.env.NUVIO_API_KEY || "sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN";

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 10_000;

export function isNuvioConfigured(): boolean {
  return Boolean(process.env.NUVIO_EMAIL && process.env.NUVIO_PASSWORD);
}

/**
 * Whether Nuvio interactions should run: credentials must be configured AND
 * the user-facing "Nuvio sync" setting must not be switched off. Defaults to
 * enabled when the setting has never been stored.
 */
export async function isNuvioSyncEnabled(): Promise<boolean> {
  if (!isNuvioConfigured()) return false;
  const settings = await getAppSettings();
  return settings.nuvio_sync_enabled !== false;
}

function profileId(): number {
  const n = Number(process.env.NUVIO_PROFILE_ID);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** A library item as Nuvio returns/accepts it (server-managed fields omitted). */
export interface NuvioLibraryItem {
  content_id: string;
  content_type: string; // "movie" | "series"
  name?: string | null;
  poster?: string | null;
  poster_shape?: string | null;
  background?: string | null;
  description?: string | null;
  release_info?: string | null;
  imdb_rating?: number | null;
  genres?: string[] | null;
  addon_base_url?: string | null;
  added_at?: number | null;
}

// Fields sync_push_library accepts — everything else (id, user_id, timestamps)
// is server-managed and must be stripped before pushing a pulled item back.
const PUSH_FIELDS = [
  "content_id",
  "content_type",
  "name",
  "poster",
  "poster_shape",
  "background",
  "description",
  "release_info",
  "imdb_rating",
  "genres",
  "addon_base_url",
  "added_at",
] as const;

function toPushItem(item: NuvioLibraryItem): NuvioLibraryItem {
  const out: Record<string, unknown> = {};
  for (const field of PUSH_FIELDS) {
    if (item[field] !== undefined) out[field] = item[field];
  }
  return out as unknown as NuvioLibraryItem;
}

// ---------------------------------------------------------------------------
// Auth — email/password sign-in, access token cached until shortly before expiry.
// ---------------------------------------------------------------------------

let session: { token: string; expiresAt: number } | null = null;

async function signIn(): Promise<string> {
  const email = process.env.NUVIO_EMAIL;
  const password = process.env.NUVIO_PASSWORD;
  if (!email || !password) {
    throw new Error("Nuvio is not configured (set NUVIO_EMAIL and NUVIO_PASSWORD)");
  }
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Nuvio sign-in failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  session = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
  };
  return session.token;
}

async function accessToken(): Promise<string> {
  if (session && Date.now() < session.expiresAt) return session.token;
  return signIn();
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken();
    const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Cached token may have been revoked server-side — re-sign-in once.
    if (res.status === 401 && attempt === 0) {
      session = null;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Nuvio ${fn} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/** Pull the complete Nuvio library for the configured profile (all pages). */
export async function pullNuvioLibrary(): Promise<NuvioLibraryItem[]> {
  const items: NuvioLibraryItem[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await rpc<NuvioLibraryItem[]>("sync_pull_library", {
      p_profile_id: profileId(),
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    items.push(...(batch ?? []));
    if (!batch || batch.length < PAGE_SIZE) return items;
  }
  // sync_push_library is full-replace: pushing a truncated pull would delete
  // everything beyond the cap, so bail out instead of risking data loss.
  throw new Error(`Nuvio library exceeds ${MAX_PAGES * PAGE_SIZE} items; aborting sync`);
}

export interface NuvioWatchedItem {
  content_id: string;
  content_type: string;
  title?: string | null;
  season?: number | null;
  episode?: number | null;
  watched_at?: number | null;
}

/** Pull the complete Nuvio watch history for the configured profile.
 * Additive use only — safe to return a capped subset (no full-replace push). */
export async function pullNuvioWatched(): Promise<NuvioWatchedItem[]> {
  const items: NuvioWatchedItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await rpc<NuvioWatchedItem[]>("sync_pull_watched_items", {
      p_profile_id: profileId(),
      p_page: page,
      p_page_size: PAGE_SIZE,
    });
    items.push(...(batch ?? []));
    if (!batch || batch.length < PAGE_SIZE) break;
  }
  return items;
}

export type ParsedNuvioItem =
  | { source: "tmdb"; tmdbId: number; mediaType: MediaType; title: string; poster: string | null }
  | { source: "imdb"; imdbId: string; mediaType: MediaType | null; title: string; poster: string | null };

/**
 * Map a Nuvio library item to a known identity. Nuvio content ids are either
 * TMDB-backed ("tmdb:550") or IMDb-backed ("tt0137523", the default from the
 * Cinemeta addon). IMDb items still need resolving to a TMDB id by the caller.
 * Null when the id scheme is unrecognized.
 */
export function parseNuvioItem(item: NuvioLibraryItem): ParsedNuvioItem | null {
  const contentId = item.content_id ?? "";
  const mediaType: MediaType | null =
    item.content_type === "movie" ? "movie"
    : item.content_type === "series" || item.content_type === "tv" ? "tv"
    : null;
  const title = item.name ?? "";
  const poster = item.poster ?? null;

  if (contentId.startsWith("tmdb:")) {
    const tmdbId = Number(contentId.slice("tmdb:".length));
    if (!Number.isFinite(tmdbId) || !mediaType) return null;
    return { source: "tmdb", tmdbId, mediaType, title, poster };
  }

  const imdbId = contentId.startsWith("imdb:") ? contentId.slice("imdb:".length) : contentId;
  if (/^tt\d+$/.test(imdbId)) return { source: "imdb", imdbId, mediaType, title, poster };

  return null;
}

export interface NuvioAddEntry {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  poster?: string | null;
  background?: string | null;
  description?: string | null;
  releaseInfo?: string | null;
}

export interface NuvioWatchedEntry {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  imdbId?: string | null;
}

/**
 * Record a title in Nuvio's watch history. The endpoint is a non-destructive
 * merge, so this is a single upsert with no pull required. Prefers the IMDb id
 * — the scheme Nuvio's own clients write — so the entry dedupes against
 * history created inside Nuvio.
 */
export async function markWatchedOnNuvio(entry: NuvioWatchedEntry): Promise<void> {
  await rpc<void>("sync_push_watched_items", {
    p_profile_id: profileId(),
    p_items: [
      {
        content_id: entry.imdbId || `tmdb:${entry.tmdbId}`,
        content_type: entry.mediaType === "tv" ? "series" : "movie",
        title: entry.title || undefined,
        watched_at: Date.now(),
      },
    ],
  });
}

/**
 * Remove one title from the Nuvio library (full-replace push of the filtered
 * list). Items imported from Nuvio are keyed by IMDb id rather than tmdb:, so
 * pass `imdbId` when known to match those too. Returns false when nothing in
 * the library matched.
 */
export async function removeFromNuvioLibrary(
  tmdbId: number,
  mediaType: MediaType,
  imdbId?: string | null,
): Promise<boolean> {
  const library = await pullNuvioLibrary();
  const contentType = mediaType === "tv" ? "series" : "movie";
  const ids = new Set([`tmdb:${tmdbId}`]);
  if (imdbId) {
    ids.add(imdbId);
    ids.add(`imdb:${imdbId}`);
  }
  const filtered = library.filter(
    (i) => !(ids.has(i.content_id) && i.content_type === contentType),
  );
  if (filtered.length === library.length) return false;
  await rpc<void>("sync_push_library", {
    p_profile_id: profileId(),
    p_items: filtered.map(toPushItem),
  });
  return true;
}

/**
 * Add one title to the Nuvio library. The push endpoint is full-replace, so
 * this pulls the complete current library, appends, and pushes it all back.
 * Returns false (without pushing) when the title is already in the library.
 */
export async function addToNuvioLibrary(entry: NuvioAddEntry): Promise<boolean> {
  const library = await pullNuvioLibrary();
  const contentId = `tmdb:${entry.tmdbId}`;
  const contentType = entry.mediaType === "tv" ? "series" : "movie";
  if (library.some((i) => i.content_id === contentId && i.content_type === contentType)) {
    return false;
  }
  const newItem: NuvioLibraryItem = {
    content_id: contentId,
    content_type: contentType,
    name: entry.title || undefined,
    poster: entry.poster ?? undefined,
    background: entry.background ?? undefined,
    description: entry.description ?? undefined,
    release_info: entry.releaseInfo ?? undefined,
    added_at: Date.now(),
  };
  await rpc<void>("sync_push_library", {
    p_profile_id: profileId(),
    p_items: [...library.map(toPushItem), newItem],
  });
  return true;
}
