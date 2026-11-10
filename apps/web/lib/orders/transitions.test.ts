import { describe, expect, it } from "vitest";
import {
  KOT_STATUSES, ORDER_STATUSES, TABLE_STATUSES, canTransitionKot, canTransitionOrder, canTransitionTable,
  nextOrderStatusFromTickets, requiredPermission,
} from "./transitions";

const pairs = <T extends string>(all: readonly T[], ok: (a: T, b: T) => boolean) =>
  all.flatMap((a) => all.filter((b) => ok(a, b)).map((b) => `${a}>${b}`)).sort().join(",");

describe("transition matrices (the same strings are pinned in supabase/tests/database/014_orders.test.sql)", () => {
  it("order", () => {
    expect(pairs(ORDER_STATUSES, canTransitionOrder)).toBe(
      "accepted>cancelled,accepted>preparing,draft>cancelled,draft>placed,placed>accepted,placed>cancelled,preparing>cancelled,preparing>ready,ready>cancelled,ready>served,served>completed",
    );
  });
  it("KOT", () => {
    expect(pairs(KOT_STATUSES, canTransitionKot)).toBe("in_progress>ready,new>in_progress,ready>bumped");
  });
  it("table", () => {
    expect(pairs(TABLE_STATUSES, canTransitionTable)).toBe(
      "available>occupied,available>reserved,needs_cleaning>available,occupied>needs_cleaning,reserved>occupied",
    );
  });
  it("cancel is refused once served, terminal states have no exits, nothing goes backwards", () => {
    expect(canTransitionOrder("served", "cancelled")).toBe(false);
    for (const t of ["completed", "cancelled"] as const) for (const s of ORDER_STATUSES) expect(canTransitionOrder(t, s)).toBe(false);
    expect(canTransitionOrder("ready", "preparing")).toBe(false);
    expect(canTransitionKot("bumped", "new")).toBe(false);
  });
});

describe("requiredPermission", () => {
  it("maps each manual transition to its permission and derived ones to system", () => {
    expect(requiredPermission("order", "served")).toBe("orders.create");
    expect(requiredPermission("order", "cancelled")).toBe("orders.void");
    expect(requiredPermission("order", "preparing")).toBe("system");
    expect(requiredPermission("order", "ready")).toBe("system");
    expect(requiredPermission("order", "completed")).toBe("system");
    expect(requiredPermission("kot", "bumped")).toBe("kitchen.update");
    expect(requiredPermission("table", "available")).toBe("orders.create");
    expect(requiredPermission("table", "needs_cleaning")).toBe("system");
  });
});

describe("nextOrderStatusFromTickets", () => {
  it("no tickets (everything station-less): accepted walks to ready in two steps", () => {
    expect(nextOrderStatusFromTickets("accepted", [])).toEqual(["preparing", "ready"]);
  });
  it("only new tickets: stays accepted", () => {
    expect(nextOrderStatusFromTickets("accepted", ["new", "new"])).toEqual([]);
  });
  it("one in_progress: preparing", () => {
    expect(nextOrderStatusFromTickets("accepted", ["new", "in_progress"])).toEqual(["preparing"]);
  });
  it("ready mixed with new: preparing", () => {
    expect(nextOrderStatusFromTickets("accepted", ["ready", "new"])).toEqual(["preparing"]);
    expect(nextOrderStatusFromTickets("preparing", ["ready", "new"])).toEqual([]);
  });
  it("all live tickets ready: ready", () => {
    expect(nextOrderStatusFromTickets("preparing", ["ready", "ready"])).toEqual(["ready"]);
    expect(nextOrderStatusFromTickets("accepted", ["ready"])).toEqual(["preparing", "ready"]);
  });
  it("all bumped (nothing live): ready", () => {
    expect(nextOrderStatusFromTickets("preparing", ["bumped", "bumped"])).toEqual(["ready"]);
  });
  it("all-void orders pass no tickets and also reach ready", () => {
    expect(nextOrderStatusFromTickets("preparing", [])).toEqual(["ready"]);
  });
  it("a ready order only goes back to preparing for an add-on round", () => {
    expect(nextOrderStatusFromTickets("ready", ["new"])).toEqual([]);
    expect(nextOrderStatusFromTickets("ready", ["new"], true)).toEqual(["preparing"]);
    expect(nextOrderStatusFromTickets("ready", ["ready"], true)).toEqual([]);
  });
  it("does nothing outside accepted / preparing / ready", () => {
    for (const s of ["draft", "placed", "served", "completed", "cancelled"] as const) expect(nextOrderStatusFromTickets(s, [])).toEqual([]);
  });
});
