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

let result: { data: unknown; error: { code?: string; message?: string } | null } = { data: { id: LOC }, error: null };
const updates: unknown[] = [];
const filters: string[] = [];
function chain() {
  const c: Record<string, unknown> = {};
  c.update = (payload: unknown) => { updates.push(payload); return c; };
  c.eq = (col: string, v: string) => { filters.push(`${col}=${v}`); return c; };
  c.select = () => c;
  c.maybeSingle = async () => result;
  return c;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain() }) }));

import { updateLocationTaxId } from "./actions";

const form = (v?: string) => { const fd = new FormData(); if (v !== undefined) fd.append("taxId", v); return fd; };

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  filters.length = 0;
  result = { data: { id: LOC }, error: null };
  requirePermission.mockResolvedValue(undefined);
});

describe("updateLocationTaxId", () => {
  it("normalizes separators to digits and writes only tax_id, scoped by the server's org and location", async () => {
    expect(await updateLocationTaxId("demo", LOC, null, form("12.345.678.9-012.345"))).toEqual({ ok: true });
    expect(updates).toEqual([{ tax_id: "123456789012345" }]);
    expect(filters).toEqual([`id=${LOC}`, `organization_id=${ORG}`]);
    expect(requirePermission).toHaveBeenCalledWith(ORG, "locations.manage");
    expect(updateTag).toHaveBeenCalledWith(`bills:${LOC}`);
  });
  it("empty clears it (null)", async () => {
    expect(await updateLocationTaxId("demo", LOC, null, form(""))).toEqual({ ok: true });
    expect(await updateLocationTaxId("demo", LOC, null, form())).toEqual({ ok: true });
    expect(updates).toEqual([{ tax_id: null }, { tax_id: null }]);
  });
  it.each(["12345", "12345678901234567", "ABCDEFGHIJKLMNO"])("rejects %j with a field error and never writes", async (v) => {
    expect(await updateLocationTaxId("demo", LOC, null, form(v))).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.any(String)] } });
    expect(updates).toHaveLength(0);
  });
  it("no permission: requirePermission refuses before anything is written", async () => {
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(updateLocationTaxId("demo", LOC, null, form("123456789012345"))).rejects.toBeInstanceOf(Forbidden);
    expect(updates).toHaveLength(0);
  });
  it("zero rows updated (RLS refused) is FORBIDDEN, not success", async () => {
    result = { data: null, error: null };
    expect(await updateLocationTaxId("demo", LOC, null, form("123456789012345"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("a check violation maps to the field error; other errors are generic and never echo SQL", async () => {
    result = { data: null, error: { code: "23514", message: "violates check constraint locations_tax_id_format" } };
    expect(await updateLocationTaxId("demo", LOC, null, form("123456789012345"))).toMatchObject({ ok: false, fieldErrors: { taxId: [expect.any(String)] } });
    result = { data: null, error: { code: "XX000", message: "secret sql text" } };
    const r = await updateLocationTaxId("demo", LOC, null, form("123456789012345"));
    expect(r).toMatchObject({ ok: false, formError: "Something went wrong. Please try again." });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("a location the caller cannot access is forbidden", async () => {
    await expect(updateLocationTaxId("demo", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", null, form("123456789012345"))).rejects.toBeInstanceOf(Forbidden);
    expect(updates).toHaveLength(0);
  });
});
