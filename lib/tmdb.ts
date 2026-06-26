import type {
  MediaType,
  MoodProfile,
  Provider,
  Recommendation,
  Review,
} from "./types";
import type { Candidate, Pick } from "./anthropic";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

function region(): string {
  return process.env.TMDB_REGION || "US";
}

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  return key;
}

async function tmdb<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function imageUrl(path: string | null | undefined, size: string): string | null {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

interface GenreList {
  genres: { id: number; name: string }[];
}

const genreCache = new Map<MediaType, Map<string, number>>();

async function genreNameToId(type: MediaType): Promise<Map<string, number>> {
  const cached = genreCache.get(type);
  if (cached) return cached;
  const data = await tmdb<GenreList>(`/genre/${type}/list`);
  const map = new Map<string, number>();
  for (const g of data.genres) map.set(g.name.toLowerCase(), g.id);
  genreCache.set(type, map);
  return map;
}

/** Fuzzy-map human genre names to TMDB ids for a given media type. */
async function resolveGenreIds(names: string[], type: MediaType): Promise<number[]> {
  if (names.length === 0) return [];
  const map = await genreNameToId(type);
  const ids = new Set<number>();
  for (const name of names) {
    const n = name.toLowerCase().trim();
    for (const [genreName, id] of map) {
      if (genreName === n || genreName.includes(n) || n.includes(genreName)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Candidate pool
// ---------------------------------------------------------------------------

interface RawTitle {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  genre_ids?: number[];
}

function yearOf(t: RawTitle): string | null {
  const d = t.release_date || t.first_air_date;
  return d ? d.slice(0, 4) : null;
}

function titleOf(t: RawTitle): string {
  return t.title || t.name || "Untitled";
}

function dateField(type: MediaType): string {
  return type === "movie" ? "primary_release_date" : "first_air_date";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Date-window params per era — and never include unreleased (future) titles. */
function eraWindow(type: MediaType, era: MoodProfile["era"], months: number): Record<string, string> {
  const f = dateField(type);
  if (era === "classic") return { [`${f}.lte`]: "2012-12-31" };
  // "new" tightens the window; "any" uses the wider default — both cap at today.
  const window = era === "new" ? Math.min(months, 18) : months;
  return { [`${f}.gte`]: monthsAgoIso(window), [`${f}.lte`]: todayIso() };
}

interface StrandOpts {
  genreIds: number[];
  sortBy: string;
  voteCountGte: number;
  window: Record<string, string>;
}

/** One discover query, restricted to titles currently available on streaming (flatrate). */
async function discoverStrand(type: MediaType, opts: StrandOpts): Promise<RawTitle[]> {
  const data = await tmdb<{ results: RawTitle[] }>(`/discover/${type}`, {
    sort_by: opts.sortBy,
    include_adult: "false",
    watch_region: region(),
    with_watch_monetization_types: "flatrate", // only what's streamable right now
    "vote_count.gte": opts.voteCountGte,
    // OR across genres (pipe) so the pool stays broad and relevant, not over-narrowed.
    with_genres: opts.genreIds.length ? opts.genreIds.join("|") : undefined,
    ...opts.window,
  });
  return data.results.map((r) => ({ ...r, media_type: type }));
}

/**
 * Build a deduped candidate pool of titles that are (a) currently streaming,
 * (b) recent, and (c) on-genre — blending a "buzzing now" strand (popularity)
 * with an "acclaimed recent" strand (rating) so results are fresh, not boilerplate.
 */
export async function buildCandidatePool(profile: MoodProfile): Promise<Candidate[]> {
  const types: MediaType[] =
    profile.mediaType === "both" ? ["movie", "tv"] : [profile.mediaType];

  const idMaps = new Map<MediaType, Map<number, string>>();
  for (const type of types) {
    const nameToId = await genreNameToId(type);
    const idToName = new Map<number, string>();
    for (const [name, id] of nameToId) idToName.set(id, name);
    idMaps.set(type, idToName);
  }

  const genreIdsByType = new Map<MediaType, number[]>();
  for (const type of types) {
    genreIdsByType.set(type, await resolveGenreIds(profile.genreNames, type));
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const addRaw = (list: RawTitle[]) => {
    for (const t of list) {
      if (candidates.length >= 50) return;
      const mediaType = (t.media_type as MediaType) || "movie";
      if (!types.includes(mediaType)) continue;
      const key = `${mediaType}:${t.id}`;
      if (seen.has(key)) continue;
      if (!t.overview) continue;
      seen.add(key);

      const idToName = idMaps.get(mediaType);
      const genres = (t.genre_ids || [])
        .map((id) => idToName?.get(id))
        .filter((n): n is string => Boolean(n))
        .map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase()));

      candidates.push({
        id: t.id,
        mediaType,
        title: titleOf(t),
        year: yearOf(t),
        overview: t.overview!.slice(0, 400),
        genres,
        rating: Math.round((t.vote_average ?? 0) * 10) / 10,
        popularity: Math.round(t.popularity ?? 0),
      });
    }
  };

  for (const type of types) {
    const genreIds = genreIdsByType.get(type)!;
    // Buzzing now: most popular recent streaming titles in-genre.
    addRaw(
      await discoverStrand(type, {
        genreIds,
        sortBy: "popularity.desc",
        voteCountGte: 50,
        window: eraWindow(type, profile.era, 24),
      }),
    );
    // Acclaimed recent: best-rated recent streaming titles in-genre.
    addRaw(
      await discoverStrand(type, {
        genreIds,
        sortBy: "vote_average.desc",
        voteCountGte: 200,
        window: eraWindow(type, profile.era, 36),
      }),
    );
  }

  // Sparse genres (e.g. Reality) shrink under strict filters — relax the vote
  // floor and widen the window (still flatrate/streaming) to fill the pool out.
  if (candidates.length < 18) {
    for (const type of types) {
      addRaw(
        await discoverStrand(type, {
          genreIds: genreIdsByType.get(type)!,
          sortBy: "popularity.desc",
          voteCountGte: 10,
          window: eraWindow(type, profile.era, 60),
        }),
      );
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Enrichment (details + providers + reviews + screenshot)
// ---------------------------------------------------------------------------

interface DetailsResponse {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  backdrop_path?: string | null;
  poster_path?: string | null;
  reviews?: {
    results: {
      author: string;
      content: string;
      author_details?: { rating: number | null };
    }[];
  };
  images?: { backdrops?: { file_path: string }[] };
  "watch/providers"?: {
    results?: Record<string, { flatrate?: { provider_name: string; logo_path: string }[] }>;
  };
}

export async function enrich(pick: Pick): Promise<Recommendation | null> {
  let details: DetailsResponse;
  try {
    details = await tmdb<DetailsResponse>(`/${pick.mediaType}/${pick.id}`, {
      append_to_response: "watch/providers,reviews,images",
    });
  } catch {
    return null;
  }

  const backdrop =
    details.backdrop_path || details.images?.backdrops?.[0]?.file_path || null;

  const providersRaw =
    details["watch/providers"]?.results?.[region()]?.flatrate ?? [];
  const providers: Provider[] = providersRaw.slice(0, 6).map((p) => ({
    name: p.provider_name,
    logoUrl: imageUrl(p.logo_path, "w92"),
  }));

  const reviews: Review[] = (details.reviews?.results ?? [])
    .slice(0, 3)
    .map((r) => ({
      author: r.author,
      content: r.content,
      rating: r.author_details?.rating ?? null,
    }));

  const year = (details.release_date || details.first_air_date || "").slice(0, 4) || null;

  return {
    id: details.id,
    mediaType: pick.mediaType,
    title: details.title || details.name || "Untitled",
    year,
    description: details.overview || "No description available.",
    rating: Math.round((details.vote_average ?? 0) * 10) / 10,
    voteCount: details.vote_count ?? 0,
    screenshotUrl: imageUrl(backdrop, "w1280") ?? imageUrl(details.poster_path, "w500"),
    posterUrl: imageUrl(details.poster_path, "w500"),
    providers,
    reviews,
    whyThisFits: pick.whyThisFits,
    vibeCheck: pick.vibeCheck,
  };
}
