import type { Provider } from "@/lib/types";

export default function ProviderBadges({ providers }: { providers: Provider[] }) {
  if (providers.length === 0) {
    return (
      <span className="text-xs text-white/40">
        Streaming availability varies by region
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {providers.map((p) =>
        p.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.name}
            src={p.logoUrl}
            alt={p.name}
            title={p.name}
            className="h-7 w-7 rounded-md ring-1 ring-white/10"
          />
        ) : (
          <span
            key={p.name}
            className="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80"
          >
            {p.name}
          </span>
        ),
      )}
    </div>
  );
}
