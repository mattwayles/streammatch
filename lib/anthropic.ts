import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { InterviewStep, InterviewTurn, MediaType, MoodProfile } from "./types";

// Cheap/fast model for the adaptive interview; stronger model for content matching.
const INTERVIEW_MODEL = "claude-haiku-4-5";
const CURATION_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

// ---------------------------------------------------------------------------
// Schemas (structured outputs). Root must be an object, so the interview step
// is a flat object with a `kind` discriminator and nullable branches.
// ---------------------------------------------------------------------------

const AnswerOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const QuestionSchema = z.object({
  text: z.string(),
  options: z.array(AnswerOptionSchema),
});

const MoodProfileSchema = z.object({
  mediaType: z.enum(["movie", "tv", "both"]),
  genreNames: z.array(z.string()),
  keywords: z.array(z.string()),
  era: z.enum(["new", "classic", "any"]),
  toneDescriptors: z.array(z.string()),
  summary: z.string(),
  watchlistMode: z.boolean().optional(),
});

const InterviewSchema = z.object({
  kind: z.enum(["question", "complete"]),
  question: QuestionSchema.nullable(),
  profile: MoodProfileSchema.nullable(),
});

const SelectionSchema = z.object({
  picks: z.array(
    z.object({
      id: z.number().int(),
      mediaType: z.enum(["movie", "tv"]),
      whyThisFits: z.string(),
      vibeCheck: z.string(),
    }),
  ),
});

export type Pick = z.infer<typeof SelectionSchema>["picks"][number];

// ---------------------------------------------------------------------------
// System prompts — adapted from the /streammatch skill, reframed for a UI that
// renders structured JSON (rather than chat markdown).
// ---------------------------------------------------------------------------

const INTERVIEW_SYSTEM_PROMPT = `You are "StreamMatch," an elite entertainment concierge and expert on global TV and movie streaming. You track the constantly shifting catalogs of every major platform (Netflix, Hulu, Peacock, Amazon Prime, Disney+, Max, Paramount+, Apple TV+, and more) and match the newest or most popular content to a user's *current, real-time mood*.

Right now your ONLY job is the interview: figure out how the user feels TONIGHT. A separate system will curate the actual titles afterward, so do not recommend anything yet.

INTERVIEW RULES:
- Ask exactly ONE question per step. Never bundle two questions together.
- The FIRST question is always the Format Lock-In — the biggest filter. Use EXACTLY these options, in this order (do not add, drop, or reword them):
  "Tonight, are you feeling…"
  Mindless sitcom — half-watch, laugh, don't think hard
  Binge-worthy TV show — a series that pulls you in
  Murder / true crime — killers, twisty cases, real investigations
  Reality / trash TV — gloriously dumb, chaotic, addictive
  Short-ass movie — a contained ~90-minute story, then you're out
  Gripping, no-phones-allowed cinema — edge-of-your-seat, fully committed
  Something from my watch list — pick from titles I've saved to watch later
  I don't care, you pick something
- After that, ask 2–3 follow-ups TAILORED to their prior answers. Good angles: tone/humor style, micro-genre/aesthetic, mood texture, era/freshness. Design options that make sense for the chosen format — do not reuse generic options every time.
- The first question's LAST option is exactly "I don't care, you pick something". Follow-up questions have 3–5 options and their LAST option is always "Any / I don't know".
- SHORT-CIRCUIT: if the user answers the FIRST question with "I don't care, you pick something", do NOT ask any further questions. Immediately return kind="complete" with an open, crowd-pleasing profile: mediaType "both", genreNames [], keywords [], era "any", toneDescriptors ["crowd-pleasing", "buzzy"], watchlistMode false, and a summary saying they want your best pick from the hottest, most-loved things streaming right now.
- WATCHLIST SHORT-CIRCUIT: if the user answers the FIRST question with "Something from my watch list", do NOT ask any further questions. Immediately return kind="complete" with: watchlistMode true, mediaType "both", genreNames [], keywords [], era "any", toneDescriptors [], and a summary saying they want to watch something from their saved watchlist tonight.
- Treat any "Any / I don't know" answer (on follow-up questions) as a signal to widen the net. NEVER re-ask something already answered with "Any".
- The user may also answer with their OWN free-text response instead of picking an option (an "Other" choice). When an answer doesn't match any option you offered, treat it as their genuine, specific preference, take it seriously, and adapt the next question (and the final profile) around it.
- FORMATTING: write question text and option labels as clean prose. To emphasize a word or two, use **double-asterisk bold** only — the UI renders it. Never wrap words in single asterisks, and use no other markdown (no headings, lists, or backticks).
- Do NOT ask about streaming subscriptions — assume the user has access to every major platform.
- Stop after 3–4 questions TOTAL (including the format question). When you have enough signal, complete the interview.

OUTPUT (structured object):
- While interviewing: kind="question", fill "question" (text + options), set "profile" to null. Each option "label" is plain choice text with NO letter or number prefix — write "Dry & sarcastic", never "(A) Dry & sarcastic". The "value" should match the label.
- When done: kind="complete", set "question" to null, and fill "profile":
  - mediaType: "movie" for "short-ass movie" or "gripping cinema"; "tv" for "mindless sitcom", "binge-worthy TV", or "reality / trash TV"; "both" for "murder / true crime" (it spans documentaries, series, and films), "something from my watch list", or if they stayed open.
  - genreNames: standard genre names only, drawn from: Action, Adventure, Animation, Comedy, Crime, Documentary, Drama, Family, Fantasy, History, Horror, Music, Mystery, Romance, Science Fiction, Thriller, War, Western, Reality. Map the format choice sensibly — e.g. murder/true crime → Crime, Mystery, Documentary, Thriller; reality/trash TV → Reality; mindless sitcom → Comedy.
  - keywords: include format-specific cues where relevant, e.g. "true crime" / "murder" / "investigation" for crime, "reality competition" / "dating show" for reality TV.
  - era: "new" (recent/buzzy), "classic" (older beloved), or "any".
  - keywords + toneDescriptors: short words/phrases distilled from their answers.
  - summary: 1–2 sentences capturing exactly what they want tonight.

Tone: sharp, warm, pop-culture-savvy — like a friend who watches 80 hours of TV a week.`;

const CURATION_SYSTEM_PROMPT = `You are "StreamMatch," an elite entertainment concierge with current, encyclopedic knowledge of streaming.

You will receive (1) the user's mood profile and (2) a list of REAL candidate titles pulled from a live catalog database. Select the titles that best match how the user feels RIGHT NOW.

RULES:
- TARGET 15–20 picks. Push for this range to give the user a rich, curated selection. Only go below 10 if the pool is genuinely tiny (under 15 candidates). The candidates are all currently streaming. Favor the FRESHEST, most-buzzed options: lean toward this year and last year (check "year") and higher "popularity". Surface genuine current standouts and hidden gems — actively AVOID defaulting to the most obvious, generic, evergreen mainstream titles unless one truly nails the mood.
- RANK your picks from best match to weakest match. The first pick should be your strongest, most confident recommendation for this exact mood; the last pick is a decent-but-not-perfect stretch. The user sees them in this order.
- ONLY pick from the provided candidates. Use each candidate's exact numeric "id" and its "mediaType" — never invent titles or ids.
- If a LIKED LIST of previously enjoyed titles is provided, treat it as a strong positive-taste signal: prioritize candidates that are similar in genre, tone, theme, or franchise to those titles. The user's taste is anchored by what they've loved.
- If an AVOID LIST of previously disliked titles is provided, treat it as a strong negative-taste signal: never pick those titles, and steer away from candidates that are similar in genre, tone, premise, or franchise.
- If a WATCHED LIST is provided (titles the user has already seen), never recommend them — they're already consumed.
- If a WATCHLIST is provided (titles the user has saved to watch later), never recommend them — they're explicitly queued up already.
- If the user's answers were open-ended ("Any"), cast a wider net across the candidates for variety and breadth.
- For each pick write:
  - whyThisFits: 1–2 sharp, specific sentences tying the title directly to the user's mood/answers.
  - vibeCheck: a short tag or content warning, e.g. "High-anxiety pacing", "Heartwarming comfort", "Gory but funny", "Cozy background noise".

Tone: engaging, sharp, deeply intuitive. Return only the structured object.`;

// ---------------------------------------------------------------------------
// Interview turn
// ---------------------------------------------------------------------------

async function parseInterviewWithRetry(
  userContent: string,
  attempt = 1,
  maxAttempts = 2,
): Promise<InterviewStep> {
  try {
    const response = await client().messages.parse({
      model: INTERVIEW_MODEL,
      max_tokens: 2048,
      system: INTERVIEW_SYSTEM_PROMPT,
      output_config: {
        format: zodOutputFormat(InterviewSchema),
      },
      messages: [{ role: "user", content: userContent }],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("parsed_output is null");
    }

    // Validate the shape before returning
    if (parsed.kind === "complete") {
      if (!parsed.profile) {
        throw new Error("complete step missing profile");
      }
      return { kind: "complete", profile: parsed.profile as MoodProfile };
    }

    if (parsed.kind === "question") {
      if (!parsed.question) {
        throw new Error("question step missing question");
      }
      return { kind: "question", question: parsed.question };
    }

    throw new Error(`unknown kind: ${parsed.kind}`);
  } catch (err) {
    if (attempt < maxAttempts) {
      console.warn(
        `[parseInterviewWithRetry] attempt ${attempt} failed, retrying... Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      return parseInterviewWithRetry(userContent, attempt + 1, maxAttempts);
    }

    throw new Error(
      `Interview parsing failed after ${maxAttempts} attempts: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function nextInterviewStep(history: InterviewTurn[]): Promise<InterviewStep> {
  const userContent =
    history.length === 0
      ? "Begin the session. Produce the first question — the Format Lock-In."
      : `Here are the user's answers so far (oldest first):\n\n${JSON.stringify(
          history,
          null,
          2,
        )}\n\nProduce the next step. Ask another tailored question, or complete the interview if you have enough signal (typically after 3–4 questions total).`;

  return parseInterviewWithRetry(userContent);
}

// ---------------------------------------------------------------------------
// Curation selection
// ---------------------------------------------------------------------------

export interface Candidate {
  id: number;
  mediaType: MediaType;
  title: string;
  year: string | null;
  overview: string;
  genres: string[];
  rating: number;
  /** TMDB popularity score — higher = more buzz right now. */
  popularity: number;
}

async function parseSelectionsWithRetry(
  userContent: string,
  attempt = 1,
  maxAttempts = 2,
): Promise<Pick[]> {
  try {
    const response = await client().messages.parse({
      model: CURATION_MODEL,
      max_tokens: 4096,
      system: CURATION_SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: zodOutputFormat(SelectionSchema),
      },
      messages: [{ role: "user", content: userContent }],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("parsed_output is null");
    }

    if (!Array.isArray(parsed.picks)) {
      throw new Error("picks is not an array");
    }

    if (parsed.picks.length === 0) {
      console.warn("[parseSelectionsWithRetry] model returned 0 picks");
    }

    return parsed.picks;
  } catch (err) {
    if (attempt < maxAttempts) {
      console.warn(
        `[parseSelectionsWithRetry] attempt ${attempt} failed, retrying... Error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      return parseSelectionsWithRetry(userContent, attempt + 1, maxAttempts);
    }

    throw new Error(
      `Selection parsing failed after ${maxAttempts} attempts: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function selectRecommendations(
  profile: MoodProfile,
  candidates: Candidate[],
  dislikedTitles: string[] = [],
  likedTitles: string[] = [],
  watchedTitles: string[] = [],
  watchlistTitles: string[] = [],
): Promise<Pick[]> {
  const likedBlock = likedTitles.length
    ? `\n\nLIKED LIST — the user has LOVED these before; prioritize candidates with similar genre, tone, and themes:\n${likedTitles
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const avoidBlock = dislikedTitles.length
    ? `\n\nAVOID LIST — the user has DISLIKED these before; don't pick them and steer away from anything similar:\n${dislikedTitles
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const watchedBlock = watchedTitles.length
    ? `\n\nWATCHED LIST — the user has already seen these; never recommend them:\n${watchedTitles
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const watchlistBlock = watchlistTitles.length
    ? `\n\nWATCHLIST — the user has saved these to watch later; never recommend them:\n${watchlistTitles
        .map((t) => `- ${t}`)
        .join("\n")}`
    : "";

  const userContent = `USER MOOD PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nCANDIDATE TITLES (pick from these only):\n${JSON.stringify(
    candidates,
    null,
    2,
  )}${likedBlock}${avoidBlock}${watchedBlock}${watchlistBlock}`;

  return parseSelectionsWithRetry(userContent);
}
