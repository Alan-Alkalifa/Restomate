import { describe, expect, it } from "vitest";
import { saveLocationHoursSchema, updateOrderingSettingsSchema } from "./schemas";

const base = { qrEnabled: "true", onlineEnabled: "false", acceptingOrders: "true", autoAcceptQr: "false", autoAcceptOnline: "false",
  pickupLeadMinutes: "20", pickupSlotMinutes: "15", pickupMaxOrdersPerSlot: "", minOrderAmount: "0", pendingTtlMinutes: "15" };

describe("updateOrderingSettingsSchema", () => {
  it("parses the defaults; an empty capacity means no limit", () => {
    expect(updateOrderingSettingsSchema.parse(base)).toEqual({
      qrEnabled: true, onlineEnabled: false, acceptingOrders: true, autoAcceptQr: false, autoAcceptOnline: false,
      pickupLeadMinutes: 20, pickupSlotMinutes: 15, pickupMaxOrdersPerSlot: undefined, minOrderAmount: 0, pendingTtlMinutes: 15,
    });
  });
  it("a missing checkbox is off (an unchecked HTML checkbox posts nothing)", () => {
    const rest = Object.fromEntries(Object.entries(base).filter(([k]) => k !== "autoAcceptQr" && k !== "acceptingOrders"));
    expect(updateOrderingSettingsSchema.parse(rest)).toMatchObject({ autoAcceptQr: false, acceptingOrders: false });
  });
  it.each([
    ["pickupLeadMinutes", "4"], ["pickupLeadMinutes", "241"], ["pickupLeadMinutes", "1.5"], ["pickupLeadMinutes", "x"],
    ["pickupSlotMinutes", "4"], ["pickupSlotMinutes", "61"], ["pickupMaxOrdersPerSlot", "0"], ["pickupMaxOrdersPerSlot", "201"],
    ["pendingTtlMinutes", "4"], ["pendingTtlMinutes", "61"], ["minOrderAmount", "-1"], ["minOrderAmount", "1.5"], ["minOrderAmount", "1e3"],
    ["minOrderAmount", "1000000000000"], ["qrEnabled", "yes"],
  ])("rejects %s = %j", (key, value) => {
    expect(updateOrderingSettingsSchema.safeParse({ ...base, [key]: value }).success).toBe(false);
  });
  it("accepts the boundaries", () => {
    expect(updateOrderingSettingsSchema.safeParse({ ...base, pickupLeadMinutes: "5", pickupSlotMinutes: "60", pendingTtlMinutes: "60", pickupMaxOrdersPerSlot: "200", minOrderAmount: "999999999999" }).success).toBe(true);
  });
});

describe("saveLocationHoursSchema", () => {
  const parse = (v: unknown) => saveLocationHoursSchema.safeParse({ intervals: JSON.stringify(v) });
  it("sorts by day then opening time", () => {
    const r = parse([{ day: 6, opensMin: 1080, closesMin: 1440 }, { day: 1, opensMin: 1020, closesMin: 1320 }, { day: 1, opensMin: 600, closesMin: 840 }]);
    expect(r.success && r.data.intervals.map((i) => `${i.day}:${i.opensMin}`)).toEqual(["1:600", "1:1020", "6:1080"]);
  });
  it("an empty list is valid (the server refuses it only while online pickup is on)", () => expect(parse([]).success).toBe(true));
  it("touching intervals are fine, overlapping ones are not (per weekday)", () => {
    expect(parse([{ day: 1, opensMin: 600, closesMin: 840 }, { day: 1, opensMin: 840, closesMin: 900 }]).success).toBe(true);
    expect(parse([{ day: 1, opensMin: 600, closesMin: 840 }, { day: 1, opensMin: 800, closesMin: 900 }]).success).toBe(false);
    expect(parse([{ day: 1, opensMin: 600, closesMin: 840 }, { day: 2, opensMin: 600, closesMin: 840 }]).success).toBe(true);
  });
  it.each([
    [{ day: 7, opensMin: 0, closesMin: 10 }], [{ day: -1, opensMin: 0, closesMin: 10 }], [{ day: 1, opensMin: 700, closesMin: 700 }],
    [{ day: 1, opensMin: 800, closesMin: 700 }], [{ day: 1, opensMin: 1440, closesMin: 1440 }], [{ day: 1, opensMin: 0, closesMin: 1441 }],
    [{ day: 1, opensMin: 0.5, closesMin: 10 }], [{ day: 1, opensMin: 0, closesMin: 10, extra: 1 }], [{ day: "1", opensMin: 0, closesMin: 10 }],
  ])("rejects %j", (row) => expect(parse([row]).success).toBe(false));
  it("rejects more than 28 ranges, non-arrays, bad JSON and oversized input", () => {
    expect(parse(Array.from({ length: 29 }, (_, i) => ({ day: i % 7, opensMin: i * 10, closesMin: i * 10 + 5 }))).success).toBe(false);
    expect(parse({ day: 1 }).success).toBe(false);
    expect(saveLocationHoursSchema.safeParse({ intervals: "not json" }).success).toBe(false);
    expect(saveLocationHoursSchema.safeParse({ intervals: "[" + " ".repeat(9000) + "]" }).success).toBe(false);
  });
});
