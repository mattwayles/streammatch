"use client";

const LINES = [
  "Scanning tonight's catalogs…",
  "Cross-checking ratings & reviews…",
  "Matching to your mood…",
  "Curating your shortlist…",
];

import { useEffect, useState } from "react";

export default function Loader() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % LINES.length), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-8 h-16 w-16">
        <div className="absolute inset-0 animate-ping rounded-full bg-glow/40" />
        <div className="absolute inset-2 rounded-full bg-glow shadow-glow" />
      </div>
      <p className="animate-pulse-glow font-display text-2xl text-glow">
        {LINES[i]}
      </p>
    </div>
  );
}
