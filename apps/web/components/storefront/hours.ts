import { fmt } from "@/i18n/config";
import type { StorefrontDictionary } from "@/i18n/types";
import type { HoursRow } from "./menu-model";

/*
 * Opening hours, in the LOCATION's timezone (never the guest's or the server's). `openNow` itself comes from the server
 * (get_public_location_info, not cached); these helpers only describe it: today's hours, the next change and a weekly
 * summary. Pure and unit tested with a fixed `now`.
 */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Weekday (0 = Sunday) and minutes since local midnight for an instant, in an IANA timezone. */
export function localParts(now: Date, timeZone: string): { day: number; minutes: number } {
  let zone = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "UTC"; }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: day < 0 ? 0 : day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const formatMinutes = (m: number): string => {
  const clamped = Math.min(1440, Math.max(0, m));
  const h = Math.floor(clamped / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

const byStart = (a: HoursRow, b: HoursRow) => a.day - b.day || a.opens - b.opens;

/** Today's rows in the location's timezone, in time order. */
export const todayRows = (hours: readonly HoursRow[], day: number): HoursRow[] => hours.filter((h) => h.day === day).sort(byStart);

/** "10:00–14:00, 17:00–22:00" for one day, or null when there are no rows that day. */
export const rangesLabel = (rows: readonly HoursRow[]): string | null =>
  rows.length ? rows.map((r) => `${formatMinutes(r.opens)}–${formatMinutes(r.closes)}`).join(", ") : null;

export type OpenStatus =
  | { kind: "no_hours" }
  | { kind: "open"; until: string }
  | { kind: "closed"; opensAt: string | null; opensToday: boolean };

/**
 * Describes the status. `openNow` is the server's verdict (it is authoritative); `now` + `timeZone` only choose the words:
 * "until 22:00" when open, "opens 10:00" when closed. A location with no hours rows is not limited by hours.
 */
export function openStatus(hours: readonly HoursRow[], openNow: boolean, now: Date, timeZone: string): OpenStatus {
  if (hours.length === 0) return { kind: "no_hours" };
  const { day, minutes } = localParts(now, timeZone);
  const today = todayRows(hours, day);
  if (openNow) {
    const current = today.find((r) => r.opens <= minutes && minutes < r.closes);
    return { kind: "open", until: formatMinutes(current?.closes ?? today.at(-1)?.closes ?? minutes) };
  }
  const later = today.find((r) => r.opens > minutes);
  if (later) return { kind: "closed", opensAt: formatMinutes(later.opens), opensToday: true };
  // Next day with hours (look ahead a week).
  for (let i = 1; i <= 7; i++) {
    const rows = todayRows(hours, (day + i) % 7);
    if (rows.length) return { kind: "closed", opensAt: formatMinutes(rows[0].opens), opensToday: false };
  }
  return { kind: "closed", opensAt: null, opensToday: false };
}

export function statusText(s: OpenStatus, t: StorefrontDictionary["hours"]): string | null {
  if (s.kind === "no_hours") return null;
  if (s.kind === "open") return fmt(t.openUntil, { time: s.until });
  if (s.opensAt === null) return t.closed;
  return fmt(s.opensToday ? t.closedOpensToday : t.closedOpensLater, { time: s.opensAt });
}

export type WeekRow = { days: number[]; label: string };
/** Weekly summary: consecutive days with identical hours are merged ("Mon–Fri 10:00–22:00"); days without hours are "Closed". */
export function weekSummary(hours: readonly HoursRow[], t: StorefrontDictionary["hours"]): WeekRow[] {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const label = (d: number) => rangesLabel(todayRows(hours, d)) ?? t.closedDay;
  const rows: WeekRow[] = [];
  for (const d of order) {
    const l = label(d);
    const last = rows.at(-1);
    if (last && last.label === l) last.days.push(d); else rows.push({ days: [d], label: l });
  }
  return rows;
}
export const dayName = (d: number, t: StorefrontDictionary["hours"]): string => t.days[DAY_KEYS[d]];
export const dayRange = (days: readonly number[], t: StorefrontDictionary["hours"]): string =>
  days.length === 1 ? dayName(days[0], t) : `${dayName(days[0], t)}–${dayName(days[days.length - 1], t)}`;
