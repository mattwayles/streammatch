"use client";

import { useState } from "react";
import type { Review } from "@/lib/types";

function ReviewItem({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(false);
  const long = review.content.length > 240;
  const text = expanded || !long ? review.content : `${review.content.slice(0, 240)}…`;

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-semibold text-white/90">{review.author}</span>
        {review.rating != null && (
          <span className="rounded bg-glow/20 px-1.5 py-0.5 text-xs font-medium text-glow-soft">
            ★ {review.rating}/10
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-white/60">{text}</p>
      {long && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-glow-soft hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export default function ReviewList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-white/40">No viewer reviews yet.</p>;
  }
  return (
    <div className="scroll-thin flex max-h-60 flex-col gap-3 overflow-y-auto pr-1">
      {reviews.map((r, i) => (
        <ReviewItem key={i} review={r} />
      ))}
    </div>
  );
}
