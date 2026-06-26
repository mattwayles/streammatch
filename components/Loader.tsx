"use client";

import RotatingMessage from "./RotatingMessage";
import { CURATION_PHRASES } from "@/lib/phrases";

export default function Loader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-8 h-16 w-16">
        <div className="absolute inset-0 animate-ping rounded-full bg-glow/40" />
        <div className="absolute inset-2 rounded-full bg-glow shadow-glow" />
      </div>
      <RotatingMessage
        messages={CURATION_PHRASES}
        className="animate-pulse-glow font-display text-2xl text-glow"
      />
    </div>
  );
}
