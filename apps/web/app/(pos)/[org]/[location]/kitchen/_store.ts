import "server-only";

import type { KdsItemStatus, KdsTicket, KotStatus } from "@/components/kitchen/kitchen-model";

/** TEMPORARY SEAM state (see ./_data.ts and ./_actions.ts): in-memory changes on top of the fixture tickets. */
export const ticketStatus = new Map<string, KotStatus>();
export const itemStatus = new Map<string, KdsItemStatus>();

// Starting statuses of the fixture tickets in ./_data.ts (the maps above only hold changes).
export const FIXTURE_START = new Map<string, KotStatus>([
  ["00000000-0000-4000-8000-0000000000a1", "new"],
  ["00000000-0000-4000-8000-0000000000a2", "in_progress"],
  ["00000000-0000-4000-8000-0000000000a3", "ready"],
]);

export function applyOverrides(list: KdsTicket[]): KdsTicket[] {
  return list.map((t) => ({
    ...t,
    status: ticketStatus.get(t.id) ?? t.status,
    items: t.items.map((i) => ({ ...i, status: i.status === "void" ? "void" : itemStatus.get(i.id) ?? i.status })),
  }));
}
