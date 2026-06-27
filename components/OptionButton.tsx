"use client";

import type { ReactNode } from "react";

export default function OptionButton({
  label,
  onClick,
  disabled,
}: {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="glass glass-hover group flex w-full items-start justify-between rounded-2xl px-6 py-5 text-left text-lg font-medium disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span>{label}</span>
      <span className="mt-0.5 shrink-0 text-glow-soft opacity-0 transition-opacity group-hover:opacity-100">
        →
      </span>
    </button>
  );
}
