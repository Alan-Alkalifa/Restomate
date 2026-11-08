import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cacheTag = vi.fn();
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({ cacheTag: (...a: unknown[]) => cacheTag(...a), cacheLife: (...a: unknown[]) => cacheLife(...a) }));

class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
class NotFound extends Error {}
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new NotFound();
  },
  forbidden: () => {
    throw new Forbidden();
  },
}));

type Result = { data: unknown; error?: unknown };
const state = {
  claims: { data: null as unknown, error: null as unknown },
  member: { data: null, error: null } as Result,
  locations: { data: [] as unknown[] } as Result,
  rpc: {} as Record<string, Result>,
  calls: [] as { table: string; filters: [string, unknown][] }[],
  rpcCalls: [] as [string, unknown][],
};

function builder(table: string, result: () => Result) {
  const entry = { table, filters: [] as [string, unknown][] };
  state.calls.push(entry);
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      entry.filters.push([col, val]);
      return b;
    },
    order: () => b,
    maybeSingle: () => Promise.resolve(result()),
    then: (resolve: (v: Result) => unknown) => resolve(result()),
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => state.claims },
    from: (table: string) => builder(table, () => (table === "locations" ? state.locations : state.member)),
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push([fn, args]);
      return state.rpc[fn] ?? { data: null, error: null };
    },
  }),
}));

import {
  getCurrentUser,
  getOrgContext,
  hasFeature,
  requireOrgContext,
  requirePermission,
  requirePlatformAdmin,
  requireUser,
  type OrgContext,
} from "./dal";

const ORG = { id: "o-1", slug: "demo", name: "Demo", status: "active", currency: "IDR", timezone: "Asia/Jakarta" };
const memberRow = (over: Record<string, unknown> = {}) => ({
  all_locations: false,
  organizations: ORG,
  roles: { key: "cashier", name: "Cashier" },
  ...over,
});

function signedIn() {
  state.claims = { data: { claims: { sub: "u-1", email: "a@x.test" } }, error: null };
}

beforeEach(() => {
  cacheTag.mockClear();
  cacheLife.mockClear();
  state.claims = { data: null, error: null };
  state.member = { data: memberRow(), error: null };
  state.locations = { data: [{ id: "l-1", name: "Jakarta" }] };
  state.rpc = {
    my_permissions: { data: ["orders.view", "pos.use", "not.a.permission"] },
    get_org_package: { data: { code: "growth", name: "Growth", features: ["qr_ordering"], limits: { max_tables: 20, max_staff: null } } },
    has_permission: { data: true },
    is_platform_admin: { data: true },
  };
  state.calls = [];
  state.rpcCalls = [];
});

describe("getCurrentUser", () => {
  it("returns id + email from verified claims", async () => {
    signedIn();
    expect(await getCurrentUser()).toEqual({ id: "u-1", email: "a@x.test" });
    expect(cacheLife).toHaveBeenCalled();
  });
  it("defaults a missing email to an empty string", async () => {
    state.claims = { data: { claims: { sub: "u-1" } }, error: null };
    expect(await getCurrentUser()).toEqual({ id: "u-1", email: "" });
  });
  it("returns null on error, no claims, or no subject", async () => {
    state.claims = { data: null, error: new Error("bad jwt") };
    expect(await getCurrentUser()).toBeNull();
    state.claims = { data: { claims: null }, error: null };
    expect(await getCurrentUser()).toBeNull();
    state.claims = { data: { claims: { sub: "" } }, error: null };
    expect(await getCurrentUser()).toBeNull();
    state.claims = { data: { claims: { email: "a@x.test" } }, error: null };
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when signed in", async () => {
    signedIn();
    expect(await requireUser()).toEqual({ id: "u-1", email: "a@x.test" });
  });
  it("redirects to /login with a sanitized next", async () => {
    await expect(requireUser("/demo/pos?x=1")).rejects.toMatchObject({ url: "/login?next=%2Fdemo%2Fpos%3Fx%3D1" });
  });
  it("drops an unsafe next and works without one", async () => {
    await expect(requireUser("https://evil.test")).rejects.toMatchObject({ url: "/login" });
    await expect(requireUser("//evil.test")).rejects.toMatchObject({ url: "/login" });
    await expect(requireUser()).rejects.toMatchObject({ url: "/login" });
  });
});

describe("getOrgContext", () => {
  it("builds the context for an active member", async () => {
    signedIn();
    const ctx = await getOrgContext("Demo");
    expect(ctx).toEqual({
      org: { id: "o-1", slug: "demo", name: "Demo", status: "active", currency: "IDR", timezone: "Asia/Jakarta" },
      membership: { roleKey: "cashier", roleName: "Cashier", allLocations: false },
      permissions: ["orders.view", "pos.use"], // unknown keys dropped
      locations: [{ id: "l-1", name: "Jakarta" }],
      package: { code: "growth", name: "Growth", features: ["qr_ordering"], limits: { max_tables: 20, max_staff: null } },
    });
  });
  it("looks up by the user id, active status and slug only", async () => {
    signedIn();
    await getOrgContext("demo");
    expect(state.calls[0]).toEqual({
      table: "organization_members",
      filters: [["user_id", "u-1"], ["status", "active"], ["organizations.slug", "demo"]],
    });
  });
  it("tags the cache with ids only", async () => {
    signedIn();
    await getOrgContext("demo");
    expect(cacheTag).toHaveBeenCalledWith("org:o-1", "member:u-1:o-1");
    expect(JSON.stringify(cacheTag.mock.calls)).not.toContain("a@x.test");
  });
  it("is null when signed out, for a bad slug, for a non-member and on query errors", async () => {
    expect(await getOrgContext("demo")).toBeNull(); // signed out
    signedIn();
    expect(await getOrgContext("Not A Slug!")).toBeNull();
    expect(state.calls).toHaveLength(0);
    state.member = { data: null, error: null };
    expect(await getOrgContext("other")).toBeNull();
    state.member = { data: null, error: new Error("rls") };
    expect(await getOrgContext("demo")).toBeNull();
  });
  it("is null when the org row is malformed", async () => {
    signedIn();
    state.member = { data: memberRow({ organizations: { id: 1 } }), error: null };
    expect(await getOrgContext("demo")).toBeNull();
  });
  it("accepts an embedded array shape from PostgREST", async () => {
    signedIn();
    state.member = { data: memberRow({ organizations: [ORG], roles: [{ key: "owner", name: "Owner" }] }), error: null };
    const ctx = await getOrgContext("demo");
    expect(ctx?.org.id).toBe("o-1");
    expect(ctx?.membership.roleKey).toBe("owner");
  });
  it("falls back to an empty role when the embedded role is missing or empty", async () => {
    signedIn();
    state.member = { data: memberRow({ roles: [] }), error: null };
    expect((await getOrgContext("demo"))?.membership.roleKey).toBe("");
    state.member = { data: memberRow({ roles: undefined }), error: null };
    expect((await getOrgContext("demo"))?.membership.roleKey).toBe("");
  });
  it("suspended org: context returned, permissions empty, my_permissions not called", async () => {
    signedIn();
    state.member = { data: memberRow({ organizations: { ...ORG, status: "suspended" }, roles: null }), error: null };
    const ctx = await getOrgContext("demo");
    expect(ctx?.org.status).toBe("suspended");
    expect(ctx?.permissions).toEqual([]);
    expect(ctx?.membership).toEqual({ roleKey: "", roleName: "", allLocations: false });
    expect(state.rpcCalls.map(([fn]) => fn)).not.toContain("my_permissions");
  });
  it("unknown org status fails closed as suspended", async () => {
    signedIn();
    state.member = { data: memberRow({ organizations: { ...ORG, status: "weird" } }), error: null };
    const ctx = await getOrgContext("demo");
    expect(ctx?.org.status).toBe("suspended");
    expect(ctx?.permissions).toEqual([]);
  });
  it("past_due and read_only keep their permissions list", async () => {
    signedIn();
    state.member = { data: memberRow({ organizations: { ...ORG, status: "past_due" } }), error: null };
    expect((await getOrgContext("demo"))?.permissions).toEqual(["orders.view", "pos.use"]);
  });
  it("tolerates missing permissions, locations and package", async () => {
    signedIn();
    state.rpc.my_permissions = { data: null };
    state.rpc.get_org_package = { data: null };
    state.locations = { data: null };
    const ctx = await getOrgContext("demo");
    expect(ctx?.permissions).toEqual([]);
    expect(ctx?.locations).toEqual([]);
    expect(ctx?.package).toBeNull();
  });
  it("ignores a malformed package payload", async () => {
    signedIn();
    state.rpc.get_org_package = { data: { code: 1 } };
    expect((await getOrgContext("demo"))?.package).toBeNull();
  });
});

describe("requireOrgContext", () => {
  it("returns the context for a member", async () => {
    signedIn();
    expect((await requireOrgContext("demo")).org.slug).toBe("demo");
  });
  it("404s for an unknown org and a non-member identically", async () => {
    signedIn();
    state.member = { data: null, error: null };
    await expect(requireOrgContext("nope")).rejects.toBeInstanceOf(NotFound);
    await expect(requireOrgContext("other-bistro")).rejects.toBeInstanceOf(NotFound);
  });
  it("sends signed-out users to login with the org path as next", async () => {
    await expect(requireOrgContext("demo")).rejects.toMatchObject({ url: "/login?next=%2Fdemo" });
  });
});

describe("requirePermission", () => {
  it("passes when the database says yes, re-checking has_permission with the given org", async () => {
    signedIn();
    await expect(requirePermission("o-1", "orders.view")).resolves.toBeUndefined();
    expect(state.rpcCalls).toContainEqual(["has_permission", { org: "o-1", perm: "orders.view" }]);
  });
  it("403s when the permission is missing or the check errors", async () => {
    signedIn();
    state.rpc.has_permission = { data: false };
    await expect(requirePermission("o-1", "staff.manage")).rejects.toBeInstanceOf(Forbidden);
    state.rpc.has_permission = { data: null, error: new Error("boom") };
    await expect(requirePermission("o-1", "staff.manage")).rejects.toBeInstanceOf(Forbidden);
  });
  it("403s for a permission key that is not in the catalog", async () => {
    signedIn();
    await expect(requirePermission("o-1", "made.up" as never)).rejects.toBeInstanceOf(Forbidden);
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("redirects signed-out callers to login", async () => {
    await expect(requirePermission("o-1", "orders.view")).rejects.toBeInstanceOf(Redirect);
  });
});

describe("requirePlatformAdmin", () => {
  it("returns the user for a platform admin", async () => {
    signedIn();
    expect(await requirePlatformAdmin()).toEqual({ id: "u-1", email: "a@x.test" });
  });
  it("404s for everyone else, including on errors", async () => {
    signedIn();
    state.rpc.is_platform_admin = { data: false };
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(NotFound);
    state.rpc.is_platform_admin = { data: null, error: new Error("boom") };
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(NotFound);
  });
  it("redirects signed-out callers to login", async () => {
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(Redirect);
  });
});

describe("hasFeature", () => {
  const ctx = (pkg: OrgContext["package"]): OrgContext => ({
    org: { id: "o", slug: "s", name: "n", status: "active", currency: "IDR", timezone: "UTC" },
    membership: { roleKey: "owner", roleName: "Owner", allLocations: true },
    permissions: [],
    locations: [],
    package: pkg,
  });
  it("checks the plan's features", () => {
    const c = ctx({ code: "g", name: "G", features: ["qr_ordering"], limits: {} });
    expect(hasFeature(c, "qr_ordering")).toBe(true);
    expect(hasFeature(c, "reservations")).toBe(false);
  });
  it("is false without a plan", () => expect(hasFeature(ctx(null), "qr_ordering")).toBe(false));
});
