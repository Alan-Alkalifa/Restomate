import type { CSSProperties } from "react";
import type { ActiveStorefront } from "./types";

/** Branding comes only from sanitised CSS variables (brandingToCssVars); no per-tenant branches. */
export function StorefrontHome({ data, cssVars }: { data: ActiveStorefront; cssVars: Record<string, string> }) {
  return (
    <div style={cssVars as CSSProperties} className="flex min-h-screen flex-1 flex-col bg-white text-neutral-900 [font-family:var(--brand-font)]">
      <header className="px-4 py-6 text-center">
        {data.branding.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied remote logo; host not known at build time
          <img src={data.branding.logoUrl} alt="" width={96} height={96} className="mx-auto mb-3 h-24 w-24 object-contain" />
        )}
        <h1 style={{ color: "var(--brand-primary)" }} className="text-3xl font-semibold tracking-tight break-words">{data.name}</h1>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-10">
        <p role="status" className="rounded-lg border border-current/20 p-4 text-center">Menu coming soon</p>
        <section aria-labelledby="locations-heading" className="flex flex-col gap-3">
          <h2 id="locations-heading" className="text-lg font-semibold">Locations</h2>
          {data.locations.length === 0 ? (
            <p className="text-sm">No locations listed yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.locations.map((l, i) => (
                <li key={`${i}-${l.name}`} className="rounded-lg border border-current/20 p-4">
                  <p className="font-medium">{l.name}</p>
                  {(l.address || l.city) && <p className="text-sm">{[l.address, l.city].filter(Boolean).join(", ")}</p>}
                  {l.phone && <p className="text-sm"><a href={`tel:${l.phone}`} className="underline">{l.phone}</a></p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export function StorefrontUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold">This restaurant is temporarily unavailable</h1>
      <p className="text-sm">Please check back later.</p>
    </main>
  );
}
