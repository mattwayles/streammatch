// Shared domain types for StreamMatch.

export type MediaType = "movie" | "tv";

/** One labeled answer choice in an adaptive interview question. */
export interface AnswerOption {
  /** Short tappable label, e.g. "Binge-worthy TV show". */
  label: string;
  /** The value sent back as the user's answer (usually equals label). */
  value: string;
}

/** A single question presented to the user during the interview. */
export interface Question {
  text: string;
  options: AnswerOption[];
}

/**
 * The compiled result of the interview — everything `/api/recommend` needs
 * to build a TMDB candidate pool and curate matches.
 */
export interface MoodProfile {
  mediaType: "movie" | "tv" | "both";
  /** Human genre names (e.g. "Comedy", "Thriller"). Mapped to TMDB ids server-side. */
  genreNames: string[];
  /** Free-form keywords/themes to bias selection (e.g. "heist", "slow burn"). */
  keywords: string[];
  era: "new" | "classic" | "any";
  /** Mood/tone words distilled from answers (e.g. "warm", "tense", "absurd"). */
  toneDescriptors: string[];
  /** One- or two-sentence natural-language summary of what they want tonight. */
  summary: string;
}

/** A turn in the conversation, sent from the client to `/api/interview`. */
export interface InterviewTurn {
  question: string;
  answer: string;
}

/** Discriminated union returned by `/api/interview`. */
export type InterviewStep =
  | { kind: "question"; question: Question }
  | { kind: "complete"; profile: MoodProfile };

/** A single user review for a title (from TMDB). */
export interface Review {
  author: string;
  content: string;
  /** Reviewer's own 0–10 rating, if provided. */
  rating: number | null;
}

/** A streaming provider the title is available on (flatrate). */
export interface Provider {
  name: string;
  logoUrl: string | null;
}

/** A fully assembled recommendation returned by `/api/recommend`. */
export interface Recommendation {
  id: number;
  mediaType: MediaType;
  title: string;
  /** Movie release year or series first-air year. */
  year: string | null;
  /** TMDB overview — the description. */
  description: string;
  /** Aggregate rating 0–10. */
  rating: number;
  voteCount: number;
  /** Backdrop "screenshot" URL (falls back to poster). */
  screenshotUrl: string | null;
  posterUrl: string | null;
  providers: Provider[];
  reviews: Review[];
  /** Claude's editorial: why this fits the user's mood. */
  whyThisFits: string;
  /** Claude's short vibe/content-warning tag. */
  vibeCheck: string;
}
