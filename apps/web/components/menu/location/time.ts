/** "Sold out until" helpers: the end time is shown in the LOCATION's timezone, never the browser's. */

export const isSoldOut = (soldOutUntil: string | null, now: Date): boolean => !!soldOutUntil && new Date(soldOutUntil).getTime() > now.getTime();

function parts(d: Date, timeZone: string) {
  const f = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  let p;
  try {
    p = f(timeZone);
  } catch {
    p = f("UTC"); // unknown zone: never crash the page
  }
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), mon: get("month"), d: get("day"), h: get("hour"), m: get("minute") };
}

/** "23:59" when it ends on the same local day as `now`, else "10 Nov 23:59". */
export function formatSoldOutUntil(iso: string, timeZone: string, now: Date): string {
  const end = parts(new Date(iso), timeZone);
  const cur = parts(now, timeZone);
  const time = `${end.h}:${end.m}`;
  return end.y === cur.y && end.mon === cur.mon && end.d === cur.d ? time : `${end.d} ${end.mon} ${time}`;
}
