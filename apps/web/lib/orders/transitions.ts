/**
 * Order, KOT and table state machines (docs/contracts/orders.md). Pure and dependency-free.
 * Mirrored in SQL by private.order_transition_ok / kot_transition_ok / table_transition_ok and the status guard
 * triggers; pgTAP (014_orders) pins the same matrix, and transitions.test.ts pins it here with the same strings.
 */
export type OrderStatus = "draft" | "placed" | "accepted" | "preparing" | "ready" | "served" | "completed" | "cancelled";
export type KotStatus = "new" | "in_progress" | "ready" | "bumped";
export type TableStatus = "available" | "reserved" | "occupied" | "needs_cleaning";

export const ORDER_STATUSES: readonly OrderStatus[] =
  ["draft", "placed", "accepted", "preparing", "ready", "served", "completed", "cancelled"];
export const KOT_STATUSES: readonly KotStatus[] = ["new", "in_progress", "ready", "bumped"];
export const TABLE_STATUSES: readonly TableStatus[] = ["available", "reserved", "occupied", "needs_cleaning"];

const ORDER: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["placed", "cancelled"],
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
  served: ["completed"], // cancel is not allowed once served
  completed: [],
  cancelled: [],
};
const KOT: Record<KotStatus, readonly KotStatus[]> = {
  new: ["in_progress"],
  in_progress: ["ready"],
  ready: ["bumped"],
  bumped: [],
};
const TABLE: Record<TableStatus, readonly TableStatus[]> = {
  available: ["reserved", "occupied"],
  reserved: ["occupied"],
  occupied: ["needs_cleaning"],
  needs_cleaning: ["available"],
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean => ORDER[from]?.includes(to) ?? false;
export const canTransitionKot = (from: KotStatus, to: KotStatus): boolean => KOT[from]?.includes(to) ?? false;
export const canTransitionTable = (from: TableStatus, to: TableStatus): boolean => TABLE[from]?.includes(to) ?? false;

type Machine = "order" | "kot" | "table";
/** The permission a person needs to trigger a transition by hand, or "system" when only the server may do it. */
export function requiredPermission(machine: Machine, to: string): string {
  if (machine === "kot") return "kitchen.update";
  if (machine === "table") {
    if (to === "occupied" || to === "available") return "orders.create";
    if (to === "reserved") return "reservations.manage"; // reservations contract (M6)
    return "system";
  }
  if (to === "cancelled") return "orders.void";
  if (to === "placed" || to === "accepted" || to === "served") return "orders.create";
  return "system"; // preparing / ready are derived from tickets; completed comes from the bill (Bills contract)
}

const FLOW = ["accepted", "preparing", "ready"] as const;

/**
 * Derived order status from the tickets of the order (only tickets with at least one non-void item are passed;
 * `bumped` ones are not live). Returns the ordered steps to apply, each one a real transition, empty when nothing
 * changes. No live tickets at all (everything station-less, no stations, or all void/bumped) walks to `ready`.
 * `addOn` lets a `ready` order go back to `preparing` when a new round has just been added (the only backwards move).
 */
export function nextOrderStatusFromTickets(current: OrderStatus, tickets: readonly KotStatus[], addOn = false): OrderStatus[] {
  const from = FLOW.indexOf(current as (typeof FLOW)[number]);
  if (from < 0) return [];
  const live = tickets.filter((t) => t !== "bumped");
  const nNew = live.filter((t) => t === "new").length;
  const nProg = live.filter((t) => t === "in_progress").length;
  const target: (typeof FLOW)[number] =
    live.length === 0 || (nNew === 0 && nProg === 0) ? "ready" : nProg > 0 || live.length > nNew ? "preparing" : "accepted";
  const to = FLOW.indexOf(target);
  if (to > from) return FLOW.slice(from + 1, to + 1);
  if (to < from && current === "ready" && addOn) return ["preparing"];
  return [];
}
