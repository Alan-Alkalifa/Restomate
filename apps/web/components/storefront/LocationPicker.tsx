import type { StorefrontDictionary } from "@/i18n/types";
import { fmt } from "@/i18n/config";
import type { LocationWithId } from "./seam";
import { storefrontHref } from "./links";

/** Shown when the tenant has more than one active location. Each card links to that location's menu (`?location=`). */
export function LocationPicker({ locations, base, locale, t }: { locations: readonly LocationWithId[]; base: string; locale: "id" | "en"; t: StorefrontDictionary }) {
  return (
    <section aria-labelledby="locations-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="locations-heading" className="text-2xl font-bold">{t.locations.heading}</h2>
        <p className="text-neutral-700">{t.locations.intro}</p>
      </div>
      {locations.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">{t.locations.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {locations.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-300 p-4">
              <h3 className="text-lg font-semibold break-words">{l.name}</h3>
              {l.address || l.city ? <p className="text-neutral-700">{[l.address, l.city].filter(Boolean).join(", ")}</p> : null}
              {l.phone ? <p><a href={`tel:${l.phone}`} className="inline-flex min-h-12 items-center underline">{fmt(t.locations.call, { phone: l.phone })}</a></p> : null}
              <a href={storefrontHref(base, locale, { location: l.id })} className="mt-2 flex min-h-12 items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 font-bold text-[var(--brand-on-primary)]">{t.locations.select}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
