"use client";

import { useEffect, useState } from "react";

/**
 * Cycles through a list of phrases on an interval, starting at a random one
 * so consecutive loads (e.g. each question) don't show the same first message.
 */
export default function RotatingMessage({
  messages,
  intervalMs = 1700,
  className,
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [i, setI] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), intervalMs);
    return () => clearInterval(t);
  }, [messages.length, intervalMs]);

  return <span className={className}>{messages[i % messages.length]}</span>;
}
