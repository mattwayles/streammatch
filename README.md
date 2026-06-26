# StreamMatch

An aesthetic streaming recommendation engine. Answer a short, adaptive questionnaire
about how you feel **right now**, and StreamMatch matches you to the newest and most
popular content across every major platform — with real ratings, reviews, and screenshots.

It exposes the `/streammatch` "entertainment concierge" skill as a full web app:

- **Claude** is the brain — `claude-haiku-4-5` runs the adaptive interview (one tailored
  question at a time), and `claude-sonnet-4-6` curates/explains the matches. (Both are set
  in `lib/anthropic.ts`; bump either to `claude-opus-4-8` for maximum quality.)
- **TMDB** supplies the real-world data — descriptions, ratings, viewer reviews,
  screenshots (backdrops), posters, and where-to-watch.

Every recommendation includes the required fields: **title, description, user ratings +
reviews, and a screenshot**, plus a "why this fits your mood" hook and a vibe check.

A lightweight **"watched" memory** (optional, via Supabase) lets you mark any result as
seen — it's then hidden from all future suggestions.

## Stack

- Next.js (App Router) + TypeScript — deployable to Vercel
- Tailwind CSS — cinematic dark UI
- `@anthropic-ai/sdk` with structured outputs
- TMDB REST API

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the template and fill in both keys:

   ```bash
   cp .env.example .env.local
   ```

   - `ANTHROPIC_API_KEY` — from <https://console.anthropic.com/>
   - `TMDB_API_KEY` — free v3 key from <https://www.themoviedb.org/settings/api>
   - `TMDB_REGION` — optional, ISO 3166-1 (defaults to `US`) for where-to-watch
   - `SUPABASE_URL` + `SUPABASE_ANON_KEY` — optional, enables the "watched" memory.
     From your Supabase project → Project Settings → API. Then run `supabase/schema.sql`
     once in the Supabase SQL Editor to create the `streammatch_watched` table (with RLS).
     If these are unset, the app still works — watched filtering is simply skipped.

3. Run it:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>.

## How it works

```
Landing → adaptive interview (/api/interview)  → mood profile
        → curation (/api/recommend)            → results
```

- **`/api/interview`** — sends the answers so far to Claude, which returns either the
  next tailored question or a compiled `MoodProfile`.
- **`/api/recommend`** — turns the profile into a TMDB candidate pool (discover +
  trending), asks Claude to pick and explain the best ~6 matches, then enriches each pick
  with TMDB details (overview, ratings, reviews, screenshot, providers).

Both API keys are read **server-side only** and never reach the browser.

## Deploy to Vercel

1. Push to a Git repo and import it into Vercel.
2. Add `ANTHROPIC_API_KEY` and `TMDB_API_KEY` (and optionally `TMDB_REGION`) as
   environment variables.
3. Deploy.

## Project layout

```
app/
  page.tsx               # client orchestrator: landing → interview → loading → results
  layout.tsx, globals.css
  api/interview/route.ts # adaptive interview turn (Claude)
  api/recommend/route.ts # TMDB pool + Claude selection + TMDB enrichment
lib/
  anthropic.ts           # Claude client, adapted system prompts, structured-output schemas
  tmdb.ts                # TMDB client: genres, discover, trending, details, reviews, providers
  types.ts               # shared domain types
components/               # Hero, QuestionCard, OptionButton, Loader, ResultCard, ReviewList, ProviderBadges
```
