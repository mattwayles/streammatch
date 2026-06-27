"use client";

import { useState } from "react";
import type { Question } from "@/lib/types";
import OptionButton from "./OptionButton";
import RichText from "./RichText";
import RotatingMessage from "./RotatingMessage";
import { INTERVIEW_PHRASES } from "@/lib/phrases";

/** Strip a stray enumerator prefix like "(A) ", "A) ", "A. ", "1) " from a label. */
function clean(s: string): string {
  return s.replace(/^\s*(?:\([A-Za-z0-9]\)|[A-Za-z0-9][.)])\s*/, "").trim();
}

/** Split "Primary — secondary descriptor" into its two parts. */
function splitLabel(s: string): { primary: string; secondary: string | null } {
  const idx = s.indexOf(" — ");
  if (idx === -1) return { primary: s, secondary: null };
  return { primary: s.slice(0, idx), secondary: s.slice(idx + 3) };
}

export default function QuestionCard({
  question,
  questionNumber,
  busy,
  onAnswer,
}: {
  question: Question;
  questionNumber: number;
  busy: boolean;
  onAnswer: (value: string) => void;
}) {
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");

  function submitOther() {
    const text = otherText.trim();
    if (!text || busy) return;
    onAnswer(text);
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-up px-6 py-16">
      <p className="mb-3 text-sm font-medium uppercase tracking-[0.25em] text-glow-soft">
        Question {questionNumber}
      </p>
      <h2 className="mb-8 font-display text-3xl font-semibold leading-snug sm:text-4xl">
        <RichText text={question.text} />
      </h2>

      <div className="flex flex-col gap-3">
        {question.options.map((opt, i) => {
          const { primary, secondary } = splitLabel(clean(opt.label));
          return (
            <OptionButton
              key={`${questionNumber}-${i}`}
              label={
                secondary ? (
                  <span className="flex flex-col gap-1">
                    <span><RichText text={primary} /></span>
                    <span className="text-sm font-normal italic text-white/50">{secondary}</span>
                  </span>
                ) : (
                  <RichText text={primary} />
                )
              }
              disabled={busy || otherMode}
              onClick={() => onAnswer(clean(opt.value))}
            />
          );
        })}

        {/* "Other" free-text option — the typed answer is sent to the model. */}
        {!otherMode ? (
          <button
            onClick={() => setOtherMode(true)}
            disabled={busy}
            className="glass glass-hover group flex w-full items-center justify-between rounded-2xl px-6 py-5 text-left text-lg font-medium text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>Something else…</span>
            <span className="text-glow-soft opacity-0 transition-opacity group-hover:opacity-100">
              ✎
            </span>
          </button>
        ) : (
          <div className="glass rounded-2xl p-3">
            <textarea
              autoFocus
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitOther();
                }
              }}
              placeholder="Tell me in your own words what you're in the mood for…"
              rows={2}
              disabled={busy}
              className="w-full resize-none bg-transparent px-3 py-2 text-lg text-white placeholder:text-white/30 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setOtherMode(false);
                  setOtherText("");
                }}
                disabled={busy}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/60 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={submitOther}
                disabled={busy || !otherText.trim()}
                className="btn-glow rounded-full px-6 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send →
              </button>
            </div>
          </div>
        )}
      </div>

      {busy && (
        <p className="mt-6 text-center text-sm text-white/50">
          <RotatingMessage messages={INTERVIEW_PHRASES} className="animate-pulse-glow" />
        </p>
      )}
    </div>
  );
}
