"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function Hero({
  onSearch,
  onRandom,
  onStart,
}: {
  onSearch: (text: string) => void;
  onRandom: () => void;
  onStart: () => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const trimmed = text.trim();

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    );
    // Stop any in-flight recognition if the component unmounts.
    return () => recognitionRef.current?.abort();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed) onSearch(trimmed);
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    // Append dictation to whatever the user has already typed.
    baseTextRef.current = text ? `${text.trimEnd()} ` : "";

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setText(baseTextRef.current + transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-2xl animate-fade-up">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-glow-soft">
          Your entertainment concierge
        </p>
        <h1 className="font-display text-6xl font-bold leading-tight text-glow sm:text-7xl">
          Stream<span className="text-glow-soft">Match</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          What are you feeling <span className="text-white">tonight</span>?
        </p>

        <form onSubmit={submit} className="mt-8">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits; Shift+Enter for a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (trimmed) onSearch(trimmed);
                }
              }}
              rows={3}
              autoFocus
              placeholder="e.g. a cozy feel-good comedy series, a tense true-crime doc, a mind-bending sci-fi movie… or just 'surprise me'"
              className="glass w-full resize-none rounded-2xl px-5 py-4 pr-16 text-left text-base text-white placeholder-white/40 outline-none transition focus:ring-2 focus:ring-white/25"
            />
            {speechSupported && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label={listening ? "Stop dictation" : "Speak your request"}
                title={listening ? "Listening… tap to stop" : "Speak your request"}
                className={`absolute bottom-3 right-3 rounded-full p-3 text-lg leading-none transition ${
                  listening
                    ? "animate-pulse bg-white text-black"
                    : "glass glass-hover text-white"
                }`}
              >
                {listening ? "⏹" : "🎤"}
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!trimmed}
            className="btn-glow mt-5 w-full rounded-full px-10 py-4 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            Find my watch →
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onRandom}
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            🎲 Surprise me — my pick
          </button>
          <button
            type="button"
            onClick={onStart}
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            I don&apos;t know, grill me
          </button>
          <Link
            href="/search"
            className="glass glass-hover rounded-full px-6 py-3 text-sm font-semibold"
          >
            🔍 Search
          </Link>
        </div>

        {listening && (
          <p className="mt-4 text-xs text-white/50">🎙 Listening… speak now</p>
        )}

        <p className="mt-6 text-xs text-white/40">No sign-up. Just vibes.</p>
        <Link
          href="/watched"
          className="mt-4 inline-block text-sm font-medium text-glow-soft hover:underline"
        >
          View your library →
        </Link>
      </div>
    </div>
  );
}
