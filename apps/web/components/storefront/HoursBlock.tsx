import type { StorefrontDictionary } from "@/i18n/types";
import { dayRange, openStatus, statusText, weekSummary } from "./hours";
import type { LocationInfo } from "./menu-model";

/**
 * "Open now" / "Closed" and the weekly hours, in the LOCATION's timezone. `info.openNow` is the server's verdict; `now`
 * only chooses the words (until when / opens at). A location with no hours rows is not limited by hours.
 */
export function HoursBlock({ info, now, t }: { info: LocationInfo; now: Date; t: StorefrontDictionary }) {
  const status = openStatus(info.hours, info.openNow, now, info.timezone);
  const text = statusText(status, t.hours);
  return (
    <details className="rounded-xl border border-neutral-300 px-4 py-2">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
        <span>{t.hours.heading}</span>
        {text ? (
          <span data-open={info.openNow} className={`rounded-full px-3 py-1 text-sm font-bold ${info.openNow ? "bg-green-100 text-green-900" : "bg-neutral-200 text-neutral-900"}`}>
            {text}
          </span>
        ) : <span className="text-sm font-normal text-neutral-700">{t.hours.noHours}</span>}
      </summary>
      {info.hours.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2 tabular-nums">
          {weekSummary(info.hours, t.hours).map((r) => (
            <div key={r.days.join()} className="contents"><dt className="font-medium">{dayRange(r.days, t.hours)}</dt><dd>{r.label}</dd></div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}
