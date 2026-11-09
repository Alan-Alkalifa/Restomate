import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class NotFound extends Error {}
const state = { admin: true, rpcCalls: [] as [string, Record<string, unknown>][], rpc: {} as Record<string, { data?: unknown; error?: { message: string } | null }> };
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/dal", () => ({
  requirePlatformAdmin: async () => {
    if (!state.admin) throw new NotFound();
    return { id: "admin-1", email: "a@x.test" };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push([fn, args]);
      return state.rpc[fn] ?? { data: null, error: null };
    },
  }),
}));

import { setOrgStatus } from "./actions";
import { listTenants, toRpcArgs } from "./tenants";

const ORG = "0b0f3e0e-8f6b-4b43-9a53-3a3f3f3f3f3f";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const valid = { orgId: ORG, status: "suspended", reason: "Chargeback dispute" };

beforeEach(() => {
  state.admin = true;
  state.rpcCalls = [];
  state.rpc = {
    admin_list_tenants: { data: { total: 1, rows: [{ id: ORG, slug: "other-bistro" }] }, error: null },
    admin_set_org_status: { data: null, error: null },
  };
  updateTag.mockClear();
});

describe("listTenants", () => {
  it("rejects non-admins before touching the database", async () => {
    state.admin = false;
    await expect(listTenants({})).rejects.toBeInstanceOf(NotFound);
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("maps input to RPC args with 1-based paging and clamps", () => {
    expect(toRpcArgs({ q: " cafe ", status: "active", packageCode: "pro", page: 3, pageSize: 10 })).toEqual({
      q: "cafe", status_filter: "active", package_code: "pro", page_size: 10, page_offset: 20, org_id: null,
    });
    expect(() => toRpcArgs({ pageSize: 101 })).toThrow();
    expect(() => toRpcArgs({ page: 0 })).toThrow();
    expect(toRpcArgs({}).page_size).toBe(25);
  });
  it("returns rows and total from the RPC", async () => {
    const r = await listTenants({ q: "x" });
    expect(r.total).toBe(1);
    expect(state.rpcCalls[0][0]).toBe("admin_list_tenants");
  });
});

describe("setOrgStatus", () => {
  it("denies non-admins and writes nothing", async () => {
    state.admin = false;
    await expect(setOrgStatus(null, fd(valid))).rejects.toBeInstanceOf(NotFound);
    expect(state.rpcCalls).toHaveLength(0);
    expect(updateTag).not.toHaveBeenCalled();
  });
  it.each([
    ["bad orgId", { ...valid, orgId: "not-a-uuid" }, "orgId"],
    ["bad status", { ...valid, status: "past_due" }, "status"],
    ["short reason", { ...valid, reason: "no" }, "reason"],
    ["long reason", { ...valid, reason: "x".repeat(501) }, "reason"],
    ["newlines only", { ...valid, reason: "\n\n\n\n\n" }, "reason"],
    ["tabs only", { ...valid, reason: "\t\t\t\t\t" }, "reason"],
    ["NBSP only", { ...valid, reason: "\u00a0".repeat(5) }, "reason"],
    ["zero-width only", { ...valid, reason: "\u200b".repeat(5) }, "reason"],
  ])("validates input: %s", async (_n, input, field) => {
    const r = await setOrgStatus(null, fd(input));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.fieldErrors?.[field]).toBeTruthy();
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("calls admin_set_org_status (audited in SQL) and refreshes org + storefront tags", async () => {
    const r = await setOrgStatus(null, fd(valid));
    expect(r).toEqual({ ok: true });
    expect(state.rpcCalls.at(-1)).toEqual(["admin_set_org_status", { org: ORG, status: "suspended", reason: "Chargeback dispute" }]);
    expect(updateTag).toHaveBeenCalledWith(`org:${ORG}`);
    expect(updateTag).toHaveBeenCalledWith("storefront:other-bistro");
  });
  it("returns a form error and skips tags when the RPC fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.admin_set_org_status = { error: { message: "boom" } };
    const r = await setOrgStatus(null, fd(valid));
    expect(r.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("reports an unknown tenant", async () => {
    state.rpc.admin_list_tenants = { data: { total: 0, rows: [] }, error: null };
    const r = await setOrgStatus(null, fd(valid));
    expect(r).toEqual({ ok: false, formError: "Tenant not found." });
    expect(state.rpcCalls.some(([f]) => f === "admin_set_org_status")).toBe(false);
  });
});
