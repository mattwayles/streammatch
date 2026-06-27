"use client";

import { useState } from "react";
import type { Recommendation } from "@/lib/types";
import ProviderBadges from "./ProviderBadges";
import ReviewList from "./ReviewList";

export default function ResultCard({
  rec,
  onWatched,
  onDisliked,
  onLiked,
  onWatchlist,
}: {
  rec: Recommendation;
  onWatched: (rec: Recommendation) => void;
  onDisliked: (rec: Recommendation) => void;
  onLiked: (rec: Recommendation) => void;
  onWatchlist: (rec: Recommendation) => void;
}) {
  const [showReviews, setShowReviews] = useState(false);
  const [savedToWatchlist, setSavedToWatchlist] = useState(false);
  const formatLabel = rec.mediaType === "tv" ? "TV / Series" : "Movie";

  return (
    <article className="glass animate-fade-up overflow-hidden rounded-3xl shadow-card">
      {/* Screenshot */}
      <div className="relative aspect-video w-full bg-ink-800">
        {rec.screenshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rec.screenshotUrl}
            alt={`${rec.title} screenshot`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/30">
            No image
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-glow/80 px-2.5 py-1 text-xs font-semibold">
              {formatLabel}
            </span>
            <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur">
              {rec.vibeCheck}
            </span>
          </div>
          <h3 className="font-display text-2xl font-bold leading-tight text-glow">
            {rec.title}
            {rec.year && (
              <span className="ml-2 text-base font-normal text-white/60">{rec.year}</span>
            )}
          </h3>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-glow-soft">
              ★ {rec.rating.toFixed(1)}
            </span>
            <span className="text-xs text-white/40">
              {rec.voteCount.toLocaleString()} ratings
            </span>
          </div>
          <ProviderBadges providers={rec.providers} />
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-glow-soft">
            Why this fits your mood
          </p>
          <p className="text-sm leading-relaxed text-white/85">{rec.whyThisFits}</p>
        </div>

        <p className="text-sm leading-relaxed text-white/55">{rec.description}</p>

        <div className="space-y-2">
          <button
            onClick={() => setShowReviews((s) => !s)}
            className="text-sm font-medium text-glow-soft hover:underline"
          >
            {showReviews ? "Hide viewer reviews" : "Viewer reviews"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSavedToWatchlist(true);
                onWatchlist(rec);
              }}
              disabled={savedToWatchlist}
              title="Save to your watch list for later"
              className="glass glass-hover rounded-full px-4 py-2 text-xs font-semibold text-white/80 disabled:opacity-60"
            >
              {savedToWatchlist ? "🔖 Saved" : "🔖 Watch Later"}
            </button>
            <button
              onClick={() => onWatched(rec)}
              title="Mark as watched and hide it from future suggestions"
              className="glass glass-hover rounded-full px-4 py-2 text-xs font-semibold text-white/80"
            >
              ✓ Seen it
            </button>
            <button
              onClick={() => onDisliked(rec)}
              title="Not for me — hide it and refine future suggestions away from this"
              className="glass glass-hover rounded-full px-4 py-2 text-xs font-semibold text-white/80"
            >
              👎 Not for me
            </button>
            <button
              onClick={() => onLiked(rec)}
              title="Watched it and loved it — refine future suggestions toward more like this"
              className="glass glass-hover rounded-full px-4 py-2 text-xs font-semibold text-white/80"
            >
              👍 Liked it
            </button>
          </div>
        </div>
        {showReviews && (
          <div>
            <ReviewList reviews={rec.reviews} />
          </div>
        )}
      </div>
    </article>
  );
}
