"use client";

import { useEffect, useState } from "react";

interface SettingsState {
  nuvioConfigured: boolean;
  nuvio_sync_enabled: boolean;
  preferred_language: string;
  preferred_region: string;
}

const REGIONS = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
  { code: "IN", label: "India" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
];

const LANGUAGES = [
  { code: "", label: "Any language" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
];

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
          preferred_language:
            typeof data.settings?.preferred_language === "string"
              ? data.settings.preferred_language
              : "en",
          preferred_region:
            typeof data.settings?.preferred_region === "string"
              ? data.settings.preferred_region
              : "US",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load settings");
      }
    })();
  }, [open, state]);

  async function saveSetting(
    key: "nuvio_sync_enabled" | "preferred_language" | "preferred_region",
    value: boolean | string,
  ) {
    if (!state) return;
    const prev = state[key];
    setState({ ...state, [key]: value });
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
    } catch (e) {
      setState((s) => (s ? { ...s, [key]: prev } : s));
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
                    onChange={(value) => saveSetting("nuvio_sync_enabled", value)}
                  />
                </li>
                <li className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-white">Preferred language</p>
                    <p className="mt-1 text-sm text-white/50">
                      Only show search and browse results whose original language matches.
                    </p>
                  </div>
                  <select
                    value={state.preferred_language}
                    onChange={(e) => saveSetting("preferred_language", e.target.value)}
                    aria-label="Preferred language"
                    className="glass shrink-0 rounded-full bg-transparent px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/25 [&>option]:bg-ink-900"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </li>
                <li className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-white">Region</p>
                    <p className="mt-1 text-sm text-white/50">
                      The Popular feed shows titles streamable in this country, so it
                      reflects what&apos;s watchable where you are.
                    </p>
                  </div>
                  <select
                    value={state.preferred_region}
                    onChange={(e) => saveSetting("preferred_region", e.target.value)}
                    aria-label="Region"
                    className="glass shrink-0 rounded-full bg-transparent px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/25 [&>option]:bg-ink-900"
                  >
                    {REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </li>
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
