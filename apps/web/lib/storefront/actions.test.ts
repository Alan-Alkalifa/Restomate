import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app", NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" } }));

const ORG = "99999999-9999-4999-8999-999999999999";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", name: "Demo" }, locations: [{ id: LOC, name: "Main" }], permissions: ["locations.manage"], package: null }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

let hoursCount: number | null = 2;
let updateResult: { data: unknown; error: { code?: string; message?: string } | null } = { data: { location_id: LOC }, error: null };
const updates: unknown[] = [];
const filters: string[] = [];
function chain(table: string) {
  const c: Record<string, unknown> = {};
  c.select = (_cols: string, opts?: { head?: boolean }) => (opts?.head ? { eq: () => ({ eq: async () => ({ count: hoursCount, error: null }) }) } : c);
  c.update = (payload: unknown) => { updates.push({ table, payload }); return c; };
  c.eq = (col: string, v: string) => { filters.push(`${col}=${v}`); return c; };
  c.maybeSingle = async () => updateResult;
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc }) }));

import { saveLocationHours, updateOrderingSettings } from "./actions";

const form = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };
const settings = (over: Record<string, string> = {}) => form({ qrEnabled: "true", onlineEnabled: "false", acceptingOrders: "true", autoAcceptQr: "false",
  autoAcceptOnline: "false", pickupLeadMinutes: "20", pickupSlotMinutes: "15", pickupMaxOrdersPerSlot: "", minOrderAmount: "25000", pendingTtlMinutes: "15", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  filters.length = 0;
  hoursCount = 2;
  updateResult = { data: { location_id: LOC }, error: null };
  requirePermission.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: { count: 1 }, error: null });
});

describe("updateOrderingSettings", () => {
  it("writes snake_case columns scoped by the server's org and location, then refreshes the storefront", async () => {
    expect(await updateOrderingSettings("demo", LOC, null, settings())).toEqual({ ok: true });
    expect(updates).toEqual([{ table: "location_ordering_settings", payload: {
      qr_enabled: true, online_enabled: false, accepting_orders: true, auto_accept_qr: false, auto_accept_online: false,
      pickup_lead_minutes: 20, pickup_slot_minutes: 15, pickup_max_orders_per_slot: null, min_order_amount: 25000, pending_ttl_minutes: 15 } }]);
    expect(filters).toEqual([`location_id=${LOC}`, `organization_id=${ORG}`]);
    expect(requirePermission).toHaveBeenCalledWith(ORG, "locations.manage");
    expect(updateTag).toHaveBeenCalledWith("storefront:demo");
    expect(updateTag).toHaveBeenCalledWith(`venue:${LOC}`);
  });
  it("online pickup without hours is a field error and nothing is written", async () => {
    hoursCount = 0;
    const r = await updateOrderingSettings("demo", LOC, null, settings({ onlineEnabled: "true" }));
    expect(r).toMatchObject({ ok: false, code: "HOURS_REQUIRED", fieldErrors: { onlineEnabled: [expect.any(String)] } });
    expect(updates).toHaveLength(0);
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("online pickup with hours is saved", async () => {
    expect(await updateOrderingSettings("demo", LOC, null, settings({ onlineEnabled: "true" }))).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
  });
  it("the database trigger is the backstop: HOURS_REQUIRED from Postgres maps to the same field error", async () => {
    updateResult = { data: null, error: { code: "P0001", message: "HOURS_REQUIRED" } };
    expect(await updateOrderingSettings("demo", LOC, null, settings({ onlineEnabled: "true" }))).toMatchObject({ ok: false, code: "HOURS_REQUIRED", fieldErrors: { onlineEnabled: [expect.any(String)] } });
  });
  it("invalid input never reaches the database", async () => {
    expect(await updateOrderingSettings("demo", LOC, null, settings({ pickupLeadMinutes: "3", minOrderAmount: "-5" }))).toMatchObject({
      ok: false, fieldErrors: { pickupLeadMinutes: [expect.any(String)], minOrderAmount: [expect.any(String)] } });
    expect(updates).toHaveLength(0);
  });
  it("zero rows updated (RLS refused) is FORBIDDEN, not success", async () => {
    updateResult = { data: null, error: null };
    expect(await updateOrderingSettings("demo", LOC, null, settings())).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("no locations.manage: requirePermission refuses before anything is read or written", async () => {
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(updateOrderingSettings("demo", LOC, null, settings())).rejects.toBeInstanceOf(Forbidden);
    expect(updates).toHaveLength(0);
  });
  it("a location the caller cannot access is forbidden", async () => {
    await expect(updateOrderingSettings("demo", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", null, settings())).rejects.toBeInstanceOf(Forbidden);
    expect(updates).toHaveLength(0);
  });
  it("never echoes SQL text", async () => {
    updateResult = { data: null, error: { code: "XX000", message: "secret sql text" } };
    const r = await updateOrderingSettings("demo", LOC, null, settings());
    expect(r).toMatchObject({ ok: false, formError: "Something went wrong. Please try again." });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("saveLocationHours", () => {
  const intervals = JSON.stringify([{ day: 1, opensMin: 600, closesMin: 840 }]);
  it("sends the validated, sorted list to the RPC with the server's location and refreshes the storefront", async () => {
    expect(await saveLocationHours("demo", LOC, null, form({ intervals }))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_location_hours", { location_id: LOC, intervals: [{ day: 1, opensMin: 600, closesMin: 840 }] });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain(ORG);
    expect(updateTag).toHaveBeenCalledWith("storefront:demo");
  });
  it("overlapping or malformed hours are rejected before the RPC", async () => {
    const overlap = JSON.stringify([{ day: 1, opensMin: 600, closesMin: 840 }, { day: 1, opensMin: 800, closesMin: 900 }]);
    expect(await saveLocationHours("demo", LOC, null, form({ intervals: overlap }))).toMatchObject({ ok: false, fieldErrors: { intervals: [expect.any(String)] } });
    expect(await saveLocationHours("demo", LOC, null, form({ intervals: "nope" }))).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("clearing the hours while online pickup is on is the HOURS_REQUIRED field error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "HOURS_REQUIRED" } });
    expect(await saveLocationHours("demo", LOC, null, form({ intervals: "[]" }))).toMatchObject({ ok: false, code: "HOURS_REQUIRED", fieldErrors: { onlineEnabled: [expect.any(String)] } });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("an overlap the database catches maps to a field error on intervals", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "INVALID_INPUT", details: "overlap" } });
    expect(await saveLocationHours("demo", LOC, null, form({ intervals }))).toMatchObject({ ok: false, fieldErrors: { intervals: [expect.any(String)] } });
  });
  it("FORBIDDEN from the RPC and a missing permission both refuse", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    expect(await saveLocationHours("demo", LOC, null, form({ intervals }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(saveLocationHours("demo", LOC, null, form({ intervals }))).rejects.toBeInstanceOf(Forbidden);
  });
});
