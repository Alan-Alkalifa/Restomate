import "server-only";

import { connection } from "next/server";
import { getLocationMenu } from "@/lib/menu/data";
import type { KdsPayload, KdsTicket } from "@/components/kitchen/kitchen-model";
import { applyOverrides } from "./_store";

/*
 * TEMPORARY SEAM until #123 (MSC-T04, lib/orders) merges. Delete this file and import `getKdsTickets` from
 * "@/lib/orders/data" (same signature, docs/contracts/orders.md): `(orgSlug, locationId, stationId?) =>
 * Promise<{ now: string; tickets: KdsTicket[] }>`, needs kitchen.view, tickets with status != bumped, oldest first.
 *
 * It returns fixture tickets (no database) so the screen can be built and driven. Station ids come from the location's
 * real stations, so the station filter works on the Demo Restaurant. Statuses are held in memory by ./_store.ts.
 */
export async function getKdsTickets(orgSlug: string, locationId: string, stationId?: string): Promise<KdsPayload> {
  await connection(); // reads the clock: request time only
  const { stations } = await getLocationMenu(orgSlug, locationId);
  const ids = stations.filter((s) => s.isActive).map((s) => s.id);
  const now = Date.now();
  const min = (n: number) => new Date(now - n * 60_000).toISOString();
  const fixtures: KdsTicket[] = ids.length === 0 ? [] : [
    { id: "00000000-0000-4000-8000-0000000000a1", ticketNumber: 12, orderNumber: 40, tableLabel: "T3", stationId: ids[0], status: "new", createdAt: min(2),
      items: [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Nasi Goreng", variantName: "Large", quantity: 2, modifiersText: "Extra spicy, no egg", note: "Allergic to peanuts", status: "pending" },
              { id: "00000000-0000-4000-8000-0000000000b2", name: "Sate Ayam", variantName: null, quantity: 1, modifiersText: "", note: null, status: "pending" }] },
    { id: "00000000-0000-4000-8000-0000000000a2", ticketNumber: 11, orderNumber: 39, tableLabel: null, stationId: ids[ids.length > 1 ? 1 : 0], status: "in_progress", createdAt: min(12),
      items: [{ id: "00000000-0000-4000-8000-0000000000b3", name: "Es Teh", variantName: null, quantity: 3, modifiersText: "Less sugar", note: null, status: "ready" },
              { id: "00000000-0000-4000-8000-0000000000b4", name: "Kopi Susu", variantName: "Iced", quantity: 1, modifiersText: "", note: null, status: "pending" },
              { id: "00000000-0000-4000-8000-0000000000b5", name: "Jus Alpukat", variantName: null, quantity: 1, modifiersText: "", note: null, status: "void" }] },
    { id: "00000000-0000-4000-8000-0000000000a3", ticketNumber: 9, orderNumber: 37, tableLabel: "T7", stationId: ids[0], status: "ready", createdAt: min(23),
      items: [{ id: "00000000-0000-4000-8000-0000000000b6", name: "Mie Goreng", variantName: null, quantity: 1, modifiersText: "", note: null, status: "ready" }] },
  ];
  const tickets = applyOverrides(fixtures).filter((t) => t.status !== "bumped" && (!stationId || t.stationId === stationId));
  tickets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.ticketNumber - b.ticketNumber);
  return { now: new Date(now).toISOString(), tickets };
}
