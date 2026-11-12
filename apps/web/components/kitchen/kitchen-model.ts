/*
 * Pure KDS model: types, timers, ordering, filtering. No React, no IO (unit tested).
 *
 * SEAM: `KotStatus`, `KdsTicket` and `canTransitionKot` mirror lib/orders (docs/contracts/orders.md, MSC-T04 / #123).
 * When #123 is on main, import them from "@/lib/orders/data" and "@/lib/orders/transitions" and delete this section.
 */
export type KotStatus = "new" | "in_progress" | "ready" | "bumped";
export type KdsItemStatus = "pending" | "ready" | "void";
export type KdsItem = {
  id: string; name: string; variantName: string | null; quantity: number; modifiersText: string; note: string | null; status: KdsItemStatus;
};
/** No prices anywhere: the KDS payload never carries money. */
export type KdsTicket = {
  id: string; ticketNumber: number; orderNumber: number; tableLabel: string | null; stationId: string; status: KotStatus;
  createdAt: string; items: KdsItem[];
};
export type KdsPayload = { now: string; tickets: KdsTicket[] };
export type StationOption = { id: string; name: string };

const KOT: Record<KotStatus, readonly KotStatus[]> = { new: ["in_progress"], in_progress: ["ready"], ready: ["bumped"], bumped: [] };
export const canTransitionKot = (from: KotStatus, to: KotStatus): boolean => KOT[from]?.includes(to) ?? false;
// ---- end of seam ----

/** Fixed for M3 (contract): a per-location setting is on the M7 backlog. */
export const AMBER_MS = 10 * 60_000;
export const RED_MS = 20 * 60_000;
export type TimerLevel = "ok" | "amber" | "red";

export function timerLevel(ageMs: number): TimerLevel {
  if (ageMs >= RED_MS) return "red";
  if (ageMs >= AMBER_MS) return "amber";
  return "ok";
}

/**
 * Offset between the server clock and this device, taken when a payload arrives: `serverNow - deviceNow`.
 * Timers use `deviceNow + offset`, so a wrong tablet clock cannot make a ticket look late or fresh.
 */
export function clockOffset(serverNowIso: string, deviceNowMs: number): number {
  const server = Date.parse(serverNowIso);
  return Number.isFinite(server) ? server - deviceNowMs : 0;
}

/** Age of a ticket in ms (never negative) at `deviceNowMs`, corrected by the server offset. */
export function ticketAgeMs(createdAtIso: string, deviceNowMs: number, offsetMs: number): number {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, deviceNowMs + offsetMs - created);
}

export const ageMinutes = (ageMs: number): number => Math.floor(ageMs / 60_000);

/** Oldest first; ties by ticket number so the order is stable. */
export function sortTickets(tickets: readonly KdsTicket[]): KdsTicket[] {
  return [...tickets].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.ticketNumber - b.ticketNumber);
}

/** Bumped tickets leave the board; `stationId` null means all stations. */
export function visibleTickets(tickets: readonly KdsTicket[], stationId: string | null): KdsTicket[] {
  return sortTickets(tickets.filter((t) => t.status !== "bumped" && (stationId === null || t.stationId === stationId)));
}

export function countByStation(tickets: readonly KdsTicket[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tickets) if (t.status !== "bumped") counts.set(t.stationId, (counts.get(t.stationId) ?? 0) + 1);
  return counts;
}

export type KotAction = { kind: "start" | "ready" | "bump"; to: "in_progress" | "ready" | "bumped" };
/** The one button a ticket offers, following the KOT machine (no skipping, no going back). Null when it has none. */
export function nextAction(status: KotStatus): KotAction | null {
  const next = (["in_progress", "ready", "bumped"] as const).find((to) => canTransitionKot(status, to));
  if (!next) return null;
  return { kind: next === "in_progress" ? "start" : next === "ready" ? "ready" : "bump", to: next };
}
