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
  retries = 2,
): Promise<T> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    // Retry on transient server errors; bail immediately on client errors.
    const body = await res.text().catch(() => "");
    lastErr = new Error(`TMDB ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    if (res.status < 500) throw lastErr;
  }
  throw lastErr!;
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
  let data: GenreList;
  try {
    data = await tmdb<GenreList>(`/genre/${type}/list`);
  } catch (e) {
    // Degrade gracefully: return an empty map so discover calls still run
    // without a genre filter rather than crashing the whole candidate build.
    console.warn(`[tmdb] genre list unavailable for ${type}, proceeding without genre filter:`, e);
    return new Map();
  }
  const map = new Map<string, number>();
  for (const g of data.genres) map.set(g.name.toLowerCase(), g.id);
  genreCache.set(type, map);
  return map;
}

interface KeywordSearchResult {
  results: { id: number; name: string }[];
}

/** Resolve free-text keyword hints to TMDB keyword IDs (best-effort, fire-and-forget on failure). */
async function resolveKeywordIds(keywords: string[]): Promise<number[]> {
  if (keywords.length === 0) return [];
  const ids: number[] = [];
  await Promise.all(
    keywords.slice(0, 6).map(async (kw) => {
      try {
        const data = await tmdb<KeywordSearchResult>("/search/keyword", { query: kw });
        const exact = data.results.find((r) => r.name.toLowerCase() === kw.toLowerCase());
        const pick = exact ?? data.results[0];
        if (pick) ids.push(pick.id);
      } catch {
        // keyword lookup is best-effort
      }
    }),
  );
  return [...new Set(ids)];
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
// Candidate pool caching
// ---------------------------------------------------------------------------

const candidateCache = new Map<string, { candidates: Candidate[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKeyForProfile(profile: MoodProfile): string {
  return JSON.stringify({
    mediaType: profile.mediaType,
    genreNames: profile.genreNames,
    keywords: profile.keywords,
    era: profile.era,
  });
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
  poster_path?: string | null;
  backdrop_path?: string | null;
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
  keywordIds?: number[];
  sortBy: string;
  voteCountGte: number;
  window: Record<string, string>;
  /** How many TMDB pages (20 results each) to pull in parallel. Defaults to 1. */
  pages?: number;
}

/** One discover query, restricted to titles currently available on streaming (flatrate). */
async function discoverStrand(type: MediaType, opts: StrandOpts): Promise<RawTitle[]> {
  const pages = Math.max(1, opts.pages ?? 1);
  const pageResults = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) =>
      tmdb<{ results: RawTitle[] }>(`/discover/${type}`, {
        sort_by: opts.sortBy,
        include_adult: "false",
        watch_region: region(),
        with_watch_monetization_types: "flatrate", // only what's streamable right now
        "vote_count.gte": opts.voteCountGte,
        // OR across genres (pipe) so the pool stays broad and relevant, not over-narrowed.
        with_genres: opts.genreIds.length ? opts.genreIds.join("|") : undefined,
        // OR across keywords — titles must match genre AND at least one keyword, which
        // filters out genre-adjacent noise (e.g. crime dramas when intent is true-crime docs).
        with_keywords: opts.keywordIds?.length ? opts.keywordIds.join("|") : undefined,
        page: i + 1,
        ...opts.window,
      }),
    ),
  );
  return pageResults
    .flatMap((r) => {
      if (r.status === "rejected") {
        console.warn("[tmdb] discover page failed, skipping:", r.reason);
        return [];
      }
      return r.value.results;
    })
    .map((r) => ({ ...r, media_type: type }));
}

/**
 * Build a deduped candidate pool of titles that are (a) currently streaming,
 * (b) recent, and (c) on-genre — blending a "buzzing now" strand (popularity)
 * with an "acclaimed recent" strand (rating) so results are fresh, not boilerplate.
 */
async function buildCandidatePoolUncached(profile: MoodProfile): Promise<Candidate[]> {
  const types: MediaType[] =
    profile.mediaType === "both" ? ["movie", "tv"] : [profile.mediaType];

  const [idMapsRaw, genreIdsByTypeRaw, keywordIds] = await Promise.all([
    Promise.all(
      types.map(async (type) => {
        const nameToId = await genreNameToId(type);
        const idToName = new Map<number, string>();
        for (const [name, id] of nameToId) idToName.set(id, name);
        return [type, idToName] as const;
      }),
    ),
    Promise.all(
      types.map(async (type) => [type, await resolveGenreIds(profile.genreNames, type)] as const),
    ),
    resolveKeywordIds(profile.keywords ?? []),
  ]);

  const idMaps = new Map(idMapsRaw);
  const genreIdsByType = new Map(genreIdsByTypeRaw);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const addRaw = (list: RawTitle[]) => {
    for (const t of list) {
      if (candidates.length >= 120) return;
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
        posterUrl: imageUrl(t.poster_path, "w500"),
        screenshotUrl:
          imageUrl(t.backdrop_path, "w1280") ?? imageUrl(t.poster_path, "w500"),
      });
    }
  };

  // When the user's intent is documentary (e.g. true crime docs), run a dedicated
  // documentary strand FIRST so docs claim pool slots before crime dramas fill them.
  const wantsDocumentary = profile.genreNames.some(
    (g) => g.toLowerCase() === "documentary",
  );
  if (wantsDocumentary && keywordIds.length > 0) {
    const docStrands = await Promise.all(
      types.map(async (type) => {
        const docIds = await resolveGenreIds(["Documentary"], type);
        if (docIds.length === 0) return [];
        return discoverStrand(type, {
          genreIds: docIds,
          keywordIds,
          sortBy: "popularity.desc",
          voteCountGte: 10,
          window: eraWindow(type, profile.era, 48),
          pages: 2,
        });
      }),
    );
    docStrands.forEach((s) => addRaw(s));
  }

  // Fetch only popularity strand (fast, cuts API calls in half).
  // Rating strand removed to reduce latency and API load.
  const mainStrands = await Promise.all(
    types.map((type) => {
      const genreIds = genreIdsByType.get(type)!;
      return discoverStrand(type, {
        genreIds,
        keywordIds,
        sortBy: "popularity.desc",
        voteCountGte: 50,
        window: eraWindow(type, profile.era, 24),
        pages: 4,
      });
    }),
  );
  mainStrands.forEach((s) => addRaw(s));

  // Fallback level 1: keyword filter can over-constrain (e.g. "true crime" + flatrate
  // streaming returns 0 TMDB results). Drop keywords but keep genres and widen the window.
  if (candidates.length === 0 && keywordIds.length > 0) {
    const relaxedStrands = await Promise.all(
      types.map((type) =>
        discoverStrand(type, {
          genreIds: genreIdsByType.get(type)!,
          sortBy: "popularity.desc",
          voteCountGte: 20,
          window: eraWindow(type, profile.era === "classic" ? "classic" : "any", 48),
          pages: 2,
        }),
      ),
    );
    relaxedStrands.forEach((s) => addRaw(s));
  }

  // Fallback level 2: genre filter is also too tight (e.g. niche genre on flatrate).
  // Fetch popular streaming content with no constraints so results are never empty.
  if (candidates.length === 0) {
    const broadStrands = await Promise.all(
      types.map((type) =>
        discoverStrand(type, {
          genreIds: [],
          sortBy: "popularity.desc",
          voteCountGte: 100,
          window: eraWindow(type, "any", 36),
          pages: 2,
        }),
      ),
    );
    broadStrands.forEach((s) => addRaw(s));
  }

  return candidates;
}

/**
 * Build candidate pool with caching. If a pool for this profile was built
 * recently (within 5 minutes), return the cached version. Otherwise, build
 * fresh and cache the result.
 */
export async function buildCandidatePool(profile: MoodProfile): Promise<Candidate[]> {
  const cacheKey = cacheKeyForProfile(profile);
  const cached = candidateCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.candidates;
  }

  const candidates = await buildCandidatePoolUncached(profile);
  candidateCache.set(cacheKey, { candidates, timestamp: Date.now() });
  return candidates;
}

// ---------------------------------------------------------------------------
// Watchlist candidate pool — build Candidates from saved TMDB ids
// ---------------------------------------------------------------------------

interface BasicDetailsResponse {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  genres?: { id: number; name: string }[];
  poster_path?: string | null;
  backdrop_path?: string | null;
}

/**
 * Fetch lightweight TMDB details for a list of known ids and return them as
 * Candidates. Used when the user picks "Something from my watch list."
 */
export async function buildCandidatesFromIds(
  items: Array<{ id: number; mediaType: MediaType }>,
): Promise<Candidate[]> {
  const results = await Promise.allSettled(
    items.map(({ id, mediaType }) => tmdb<BasicDetailsResponse>(`/${mediaType}/${id}`)),
  );

  const candidates: Candidate[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") continue;
    const d = result.value;
    const { mediaType } = items[i];
    if (!d.overview) continue;
    candidates.push({
      id: d.id,
      mediaType,
      title: d.title || d.name || "Untitled",
      year: (d.release_date || d.first_air_date || "").slice(0, 4) || null,
      overview: d.overview.slice(0, 400),
      genres: (d.genres ?? []).map((g) => g.name),
      rating: Math.round((d.vote_average ?? 0) * 10) / 10,
      popularity: Math.round(d.popularity ?? 0),
      posterUrl: imageUrl(d.poster_path, "w500"),
      screenshotUrl:
        imageUrl(d.backdrop_path, "w1280") ?? imageUrl(d.poster_path, "w500"),
    });
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
