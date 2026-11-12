import { describe, expect, it } from "vitest";
import {
  AMBER_MS, RED_MS, ageMinutes, canTransitionKot, clockOffset, countByStation, nextAction, sortTickets, ticketAgeMs, timerLevel,
  visibleTickets, type KdsTicket, type KotStatus,
} from "./kitchen-model";

const MIN = 60_000;
const ticket = (o: Partial<KdsTicket>): KdsTicket => ({ id: "t", ticketNumber: 1, orderNumber: 1, tableLabel: null, stationId: "s1", status: "new", createdAt: "2026-11-12T10:00:00Z", items: [], ...o });

describe("timer thresholds (fixed for M3: amber 10 min, red 20 min)", () => {
  it("is ok under 10 minutes, amber from 10, red from 20, to the millisecond", () => {
    expect(timerLevel(0)).toBe("ok");
    expect(timerLevel(AMBER_MS - 1)).toBe("ok");
    expect(timerLevel(AMBER_MS)).toBe("amber");
    expect(timerLevel(RED_MS - 1)).toBe("amber");
    expect(timerLevel(RED_MS)).toBe("red");
    expect(timerLevel(3 * 60 * MIN)).toBe("red");
  });
  it("shows whole minutes, rounded down", () => {
    expect(ageMinutes(9 * MIN + 59_999)).toBe(9);
    expect(ageMinutes(10 * MIN)).toBe(10);
  });
});

describe("the server clock drives the timers", () => {
  it("a tablet running 30 minutes fast does not make a fresh ticket late", () => {
    const serverNow = "2026-11-12T10:05:00Z";
    const deviceNow = Date.parse(serverNow) + 30 * MIN; // wrong tablet clock
    const offset = clockOffset(serverNow, deviceNow);
    expect(offset).toBe(-30 * MIN);
    const age = ticketAgeMs("2026-11-12T10:00:00Z", deviceNow, offset);
    expect(age).toBe(5 * MIN);
    expect(timerLevel(age)).toBe("ok");
  });
  it("never goes negative and ignores unparseable input", () => {
    expect(ticketAgeMs("2026-11-12T10:10:00Z", Date.parse("2026-11-12T10:00:00Z"), 0)).toBe(0);
    expect(ticketAgeMs("not a date", 1000, 0)).toBe(0);
    expect(clockOffset("not a date", 1000)).toBe(0);
  });
});

describe("ordering and filtering", () => {
  it("oldest first, ties by ticket number", () => {
    const list = [
      ticket({ id: "c", ticketNumber: 3, createdAt: "2026-11-12T10:02:00Z" }),
      ticket({ id: "a", ticketNumber: 1, createdAt: "2026-11-12T10:00:00Z" }),
      ticket({ id: "b2", ticketNumber: 5, createdAt: "2026-11-12T10:01:00Z" }),
      ticket({ id: "b1", ticketNumber: 4, createdAt: "2026-11-12T10:01:00Z" }),
    ];
    expect(sortTickets(list).map((t) => t.id)).toEqual(["a", "b1", "b2", "c"]);
    expect(list[0].id).toBe("c"); // input untouched
  });
  it("hides bumped tickets and filters by station", () => {
    const list = [ticket({ id: "1", stationId: "s1" }), ticket({ id: "2", stationId: "s2" }), ticket({ id: "3", stationId: "s1", status: "bumped" })];
    expect(visibleTickets(list, null).map((t) => t.id)).toEqual(["1", "2"]);
    expect(visibleTickets(list, "s1").map((t) => t.id)).toEqual(["1"]);
    expect(countByStation(list)).toEqual(new Map([["s1", 1], ["s2", 1]]));
  });
});

describe("KOT machine: new → in_progress → ready → bumped, no skipping, no going back", () => {
  const all: KotStatus[] = ["new", "in_progress", "ready", "bumped"];
  it("allows exactly the three forward steps", () => {
    const allowed = all.flatMap((from) => all.filter((to) => canTransitionKot(from, to)).map((to) => `${from}>${to}`));
    expect(allowed).toEqual(["new>in_progress", "in_progress>ready", "ready>bumped"]);
  });
  it("offers one button per status, none once bumped", () => {
    expect(nextAction("new")).toEqual({ kind: "start", to: "in_progress" });
    expect(nextAction("in_progress")).toEqual({ kind: "ready", to: "ready" });
    expect(nextAction("ready")).toEqual({ kind: "bump", to: "bumped" });
    expect(nextAction("bumped")).toBeNull();
  });
});
