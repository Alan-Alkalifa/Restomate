import type { LocationInfo } from "./menu-model";

/*
 * Why a guest cannot order right now (the menu is always browsable). "off" covers every case where the location takes no
 * guest orders at all: both channels switched off, or a package without `qr_ordering` (one flag gates both in M4, and the
 * public read reports both channels false then). "paused" is the staff's "pause ordering" switch. Closed hours are shown
 * separately (the hours block) and never hide the menu.
 */
export type OrderingState = "available" | "paused" | "off";

export function orderingState(info: Pick<LocationInfo, "ordering">): OrderingState {
  if (!info.ordering.qr && !info.ordering.online) return "off";
  if (!info.ordering.accepting) return "paused";
  return "available";
}
