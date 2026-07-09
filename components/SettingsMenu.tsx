"use client";

import { useEffect, useState } from "react";

interface SettingsState {
  nuvioConfigured: boolean;
  nuvio_sync_enabled: boolean;
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-glow" : "bg-white/20"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** Global ⚙ settings button + modal. Rendered on every page via the root layout. */
export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SettingsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || state) return;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load settings");
        setState({
          nuvioConfigured: Boolean(data.nuvioConfigured),
          nuvio_sync_enabled: data.settings?.nuvio_sync_enabled !== false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load settings");
      }
    })();
  }, [open, state]);

  async function setNuvioSync(value: boolean) {
    if (!state) return;
    const prev = state.nuvio_sync_enabled;
    setState({ ...state, nuvio_sync_enabled: value });
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "nuvio_sync_enabled", value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
    } catch (e) {
      setState((s) => (s ? { ...s, nuvio_sync_enabled: prev } : s));
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="glass glass-hover fixed right-4 top-4 z-40 rounded-full p-3 text-lg leading-none"
      >
        ⚙
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-md rounded-3xl p-6 shadow-card"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold text-glow">Settings</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="glass glass-hover rounded-full px-3 py-1 text-sm text-white/70"
              >
                ✕
              </button>
            </div>

            {!state && !error && <p className="animate-pulse-glow text-white/40">Loading…</p>}
            {error && <p className="mb-4 text-sm text-red-300">{error}</p>}

            {state && (
              <ul className="flex flex-col gap-5">
                <li className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-white">Nuvio library sync</p>
                    <p className="mt-1 text-sm text-white/50">
                      Two-way sync between your watchlist and your Nuvio library: the Sync
                      button pulls Nuvio titles in, and watchlist saves are mirrored back.
                    </p>
                    {!state.nuvioConfigured && (
                      <p className="mt-1 text-xs text-white/40">
                        Not configured — set NUVIO_EMAIL and NUVIO_PASSWORD to enable.
                      </p>
                    )}
                  </div>
                  <ToggleSwitch
                    label="Nuvio library sync"
                    checked={state.nuvioConfigured && state.nuvio_sync_enabled}
                    disabled={!state.nuvioConfigured}
                    onChange={setNuvioSync}
                  />
                </li>
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
