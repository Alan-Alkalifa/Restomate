import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: () => ({ rpc }) }));

import { getLocationInfo, getPickupSlots, parseLocationInfo } from "./location-info";
import { getPublicMenu, parsePublicMenu } from "./public-menu";

const LOC = "11111111-1111-4111-8111-111111111111";
const info = {
  name: "Kemang", currency: "IDR", timezone: "Asia/Jakarta", address: "Jl", city: null, phone: null,
  taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true,
  hours: [{ day: 1, opens: "10:00", closes: "14:00" }], openNow: true,
  ordering: { qr: true, online: false, accepting: true }, minOrderAmount: 0, pickup: { leadMinutes: 20, slotMinutes: 15 },
};

beforeEach(() => vi.clearAllMocks());

describe("parseLocationInfo", () => {
  it("maps the public payload and nulls missing optional fields", () => {
    expect(parseLocationInfo(info)).toMatchObject({ name: "Kemang", city: null, phone: null, openNow: true, ordering: { qr: true, online: false, accepting: true } });
  });
  it("null (not public) stays null; a malformed payload throws", () => {
    expect(parseLocationInfo(null)).toBeNull();
    expect(() => parseLocationInfo({ ...info, openNow: "yes" })).toThrow();
    expect(() => parseLocationInfo({ ...info, hours: [{ day: 9, opens: "10:00", closes: "11:00" }] })).toThrow();
  });
});

describe("getLocationInfo / getPickupSlots", () => {
  it("normalises the slug and calls the public RPC with the server's arguments", async () => {
    rpc.mockResolvedValue({ data: info, error: null });
    expect(await getLocationInfo(" DEMO ", LOC)).toMatchObject({ name: "Kemang" });
    expect(rpc).toHaveBeenCalledWith("get_public_location_info", { org_slug: "demo", location_id: LOC });
  });
  it("a bad slug or a non-uuid id never reaches the database", async () => {
    expect(await getLocationInfo("not a slug!", LOC)).toBeNull();
    expect(await getLocationInfo("demo", "nope")).toBeNull();
    expect(await getPickupSlots("../x", LOC)).toEqual([]);
    expect(await getPickupSlots("demo", "nope")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("slots are validated ISO UTC strings, at most 24; anything else is dropped to []", async () => {
    rpc.mockResolvedValue({ data: ["2026-11-16T03:00:00Z", "2026-11-16T03:15:00Z"], error: null });
    expect(await getPickupSlots("demo", LOC)).toEqual(["2026-11-16T03:00:00Z", "2026-11-16T03:15:00Z"]);
    rpc.mockResolvedValue({ data: ["tomorrow"], error: null });
    expect(await getPickupSlots("demo", LOC)).toEqual([]);
    rpc.mockResolvedValue({ data: Array.from({ length: 25 }, () => "2026-11-16T03:00:00Z"), error: null });
    expect(await getPickupSlots("demo", LOC)).toEqual([]);
  });
  it("an RPC error throws instead of silently showing a closed or open location", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getLocationInfo("demo", LOC)).rejects.toThrow();
    await expect(getPickupSlots("demo", LOC)).rejects.toThrow();
  });
});

describe("public menu", () => {
  const menu = { currency: "IDR", categories: [{ id: "c1", name: "Mains", description: null, items: [{
    id: "i1", name: "Nasi", description: null, price: 35000, image_path: null, dietary_tags: ["halal"],
    variants: [{ id: "v1", name: "Large", price_delta: 5000 }],
    modifier_groups: [{ id: "g1", name: "Extras", min_select: 0, max_select: 2, modifiers: [{ id: "m1", name: "Egg", price_delta: 5000 }] }],
  }] }] };
  it("maps to camelCase", () => {
    expect(parsePublicMenu(menu)?.categories[0]?.items[0]).toMatchObject({
      price: 35000, imagePath: null, dietaryTags: ["halal"], variants: [{ priceDelta: 5000 }], modifierGroups: [{ minSelect: 0, maxSelect: 2, modifiers: [{ name: "Egg" }] }],
    });
    expect(parsePublicMenu(null)).toBeNull();
  });
  it("rejects a bad slug/id before the database", async () => {
    expect(await getPublicMenu("bad slug", LOC)).toBeNull();
    expect(await getPublicMenu("demo", "nope")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls get_public_menu with the normalised slug", async () => {
    rpc.mockResolvedValue({ data: menu, error: null });
    expect(await getPublicMenu(" Demo ", LOC)).toMatchObject({ currency: "IDR" });
    expect(rpc).toHaveBeenCalledWith("get_public_menu", { org_slug: "demo", location_id: LOC });
  });
});
