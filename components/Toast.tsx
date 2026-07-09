"use client";

import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "success" | "error";
}

const TOAST_MS = 3500;

/** Fire-and-forget toast state: `notify` queues a message, auto-dismissed. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  return { toasts, notify };
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`glass animate-fade-up rounded-full px-5 py-3 text-center text-sm font-medium shadow-card ${
            t.tone === "error" ? "text-red-300" : "text-white/90"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
