import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cacheTag = vi.fn();
const cacheLife = vi.fn();
vi.mock("next/cache", () => ({ cacheTag: (...a: unknown[]) => cacheTag(...a), cacheLife: (...a: unknown[]) => cacheLife(...a), updateTag: vi.fn() }));

type Res = { data?: unknown; count?: number | null; error?: { message: string } | null };
const db = { results: {} as Record<string, Res>, filters: [] as [string, string, unknown[]][], createClientCalls: 0 };

// A chainable fake: every method returns the builder, awaiting it yields the preset result for the table.
function builder(table: string): unknown {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "not", "in"]) {
    b[m] = (...args: unknown[]) => {
      db.filters.push([table, m, args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(db.results[table] ?? { data: null, error: null });
  b.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(db.results[table] ?? { data: [], count: 0, error: null }).then(ok, bad);
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    db.createClientCalls++;
    return { from: (t: string) => builder(t) };
  },
}));

import type { OrgContext } from "@/lib/auth/dal";
import { getSetupProgress, SETUP_STEPS } from "./progress";

const ORG = "11111111-1111-4111-8111-111111111111";
const LOC1 = "22222222-2222-4222-8222-222222222222";
const ALL_PERMS = ["settings.manage", "tables.manage", "menu.manage", "staff.manage"] as OrgContext["permissions"];
const ctx = (permissions: OrgContext["permissions"] = ALL_PERMS, locations = [{ id: LOC1, name: "Main" }]): OrgContext =>
  ({
    org: { id: ORG, slug: "demo", name: "Demo", status: "active", currency: "IDR", timezone: "Asia/Jakarta" },
    membership: { roleKey: "owner", roleName: "Owner", allLocations: true },
    permissions,
    locations,
    package: null,
  }) as OrgContext;

/** Everything empty: the state right after onboarding with no details. */
const fresh = (): Record<string, Res> => ({
  locations: { data: [{ id: LOC1, address: null }], error: null },
  roles: { data: [{ id: "owner-role" }], error: null },
  staff_invitations: { count: 0, error: null },
  org_branding: { data: { logo_url: null, logo_path: null, primary_color: null }, error: null },
  organization_members: { count: 0, error: null },
  tables: { count: 0, error: null },
  menu_items: { count: 0, error: null },
});
const doneOf = async (over: Record<string, Res> = {}, c = ctx()) => {
  db.results = { ...fresh(), ...over };
  const p = await getSetupProgress(c);
  return Object.fromEntries(p.steps.map((s) => [s.key, s.done]));
};

beforeEach(() => {
  db.results = fresh();
  db.filters = [];
  db.createClientCalls = 0;
  cacheTag.mockClear();
  cacheLife.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("shape", () => {
  it("returns all five steps in order with completed/total", async () => {
    db.results = fresh();
    const p = await getSetupProgress(ctx());
    expect(p.steps.map((s) => s.key)).toEqual([...SETUP_STEPS]);
    expect(p.total).toBe(5);
    expect(p.completed).toBe(0);
  });

  it("counts completed steps", async () => {
    db.results = {
      ...fresh(),
      tables: { count: 4, error: null },
      organization_members: { count: 1, error: null },
    };
    const p = await getSetupProgress(ctx());
    expect(p.completed).toBe(2);
    expect(p.steps.filter((s) => s.done).map((s) => s.key)).toEqual(["tables", "staff"]);
  });

  it("is tagged by org id only, cached for minutes", async () => {
    await getSetupProgress(ctx());
    expect(cacheTag).toHaveBeenCalledWith(`setup-progress:${ORG}`);
    expect(cacheLife).toHaveBeenCalledWith("minutes");
  });
});

describe("done rules (both states)", () => {
  it("location: the bare onboarding location is not done; an address or a second location is", async () => {
    expect((await doneOf()).location).toBe(false);
    expect((await doneOf({ locations: { data: [{ id: LOC1, address: "  " }], error: null } })).location).toBe(false);
    expect((await doneOf({ locations: { data: [{ id: LOC1, address: "Jl. Braga 1" }], error: null } })).location).toBe(true);
    expect((await doneOf({ locations: { data: [{ id: LOC1, address: null }, { id: "l2", address: null }], error: null } })).location).toBe(true);
  });

  it("tables: needs an active table in an active location; no locations means not done and no table query", async () => {
    expect((await doneOf()).tables).toBe(false);
    expect((await doneOf({ tables: { count: 1, error: null } })).tables).toBe(true);
    db.filters = [];
    expect((await doneOf({ locations: { data: [], error: null }, tables: { count: 9, error: null } })).tables).toBe(false);
    expect(db.filters.some(([t]) => t === "tables")).toBe(false);
  });

  it("menu: done once at least one item is active and published; the query is org-scoped", async () => {
    expect((await doneOf()).menu).toBe(false);
    db.filters = [];
    expect((await doneOf({ menu_items: { count: 1, error: null } })).menu).toBe(true);
    const f = db.filters.filter(([t]) => t === "menu_items");
    expect(f).toContainEqual(["menu_items", "eq", ["organization_id", ORG]]);
    expect(f).toContainEqual(["menu_items", "eq", ["is_active", true]]);
    expect(f).toContainEqual(["menu_items", "eq", ["is_published", true]]);
    expect(f).toContainEqual(["menu_items", "select", ["id", { count: "exact", head: true }]]);
  });
  it("menu: a failed read shows every step as not done (logged, page does not break)", async () => {
    const d = await doneOf({ menu_items: { count: 3, error: { message: "boom" } }, tables: { count: 2, error: null } });
    expect(Object.values(d).every((v) => v === false)).toBe(true);
  });
  it("all five steps can now be done", async () => {
    const d = await doneOf({
      locations: { data: [{ id: LOC1, address: "Jl. Braga 1" }], error: null }, tables: { count: 1, error: null },
      menu_items: { count: 1, error: null }, organization_members: { count: 1, error: null },
      org_branding: { data: { logo_url: "https://x.test/l.png", logo_path: null, primary_color: null }, error: null },
    });
    expect(Object.values(d)).toEqual([true, true, true, true, true]);
  });

  it("staff: another active member OR a pending invitation", async () => {
    expect((await doneOf()).staff).toBe(false);
    expect((await doneOf({ organization_members: { count: 2, error: null } })).staff).toBe(true);
    expect((await doneOf({ staff_invitations: { count: 1, error: null } })).staff).toBe(true);
  });

  it("staff: owners are excluded from the member count, and only unexpired pending invitations are counted", async () => {
    db.filters = [];
    await doneOf();
    expect(db.filters).toContainEqual(["organization_members", "not", ["role_id", "in", "(owner-role)"]]);
    expect(db.filters).toContainEqual(["organization_members", "eq", ["status", "active"]]);
    expect(db.filters.some(([t, m, a]) => t === "staff_invitations" && m === "gt" && a[0] === "expires_at")).toBe(true);
    expect(db.filters).toContainEqual(["staff_invitations", "is", ["revoked_at", null]]);
    expect(db.filters).toContainEqual(["staff_invitations", "is", ["accepted_at", null]]);
  });

  it("branding: a logo, or a colour that is not the onboarding default", async () => {
    const b = (v: Record<string, string | null>) => ({ org_branding: { data: { logo_url: null, logo_path: null, primary_color: null, ...v }, error: null } });
    expect((await doneOf()).branding).toBe(false);
    expect((await doneOf(b({ primary_color: "#0F766E" }))).branding).toBe(false); // default, any case
    expect((await doneOf(b({ primary_color: "#112233" }))).branding).toBe(true);
    expect((await doneOf(b({ logo_url: "https://x.test/l.png" }))).branding).toBe(true);
    expect((await doneOf(b({ logo_path: "org/logo.png" }))).branding).toBe(true);
    expect((await doneOf({ org_branding: { data: null, error: null } })).branding).toBe(false);
  });
});

describe("href follows the permission", () => {
  const hrefs = async (c: OrgContext) => Object.fromEntries((await getSetupProgress(c)).steps.map((s) => [s.key, s.href]));

  it("a full-permission user gets every link", async () => {
    expect(await hrefs(ctx())).toEqual({
      location: "settings",
      tables: `${LOC1}/tables`,
      menu: "menu",
      staff: "staff",
      branding: "settings",
    });
  });

  it("null without the permission, but the done state is still shown", async () => {
    db.results = { ...fresh(), tables: { count: 3, error: null } };
    const p = await getSetupProgress(ctx([]));
    expect(p.steps.map((s) => s.href)).toEqual([null, null, null, null, null]);
    expect(p.steps.find((s) => s.key === "tables")?.done).toBe(true);
  });

  it("each permission unlocks only its own steps", async () => {
    expect(await hrefs(ctx(["settings.manage"] as OrgContext["permissions"]))).toEqual({ location: "settings", tables: null, menu: null, staff: null, branding: "settings" });
    expect(await hrefs(ctx(["tables.manage"] as OrgContext["permissions"]))).toMatchObject({ tables: `${LOC1}/tables`, location: null });
    expect(await hrefs(ctx(["menu.manage"] as OrgContext["permissions"]))).toMatchObject({ menu: "menu", staff: null });
    expect(await hrefs(ctx(["staff.manage"] as OrgContext["permissions"]))).toMatchObject({ staff: "staff", menu: null });
  });

  it("tables has no link when the user has no accessible location", async () => {
    expect((await hrefs(ctx(ALL_PERMS, []))).tables).toBeNull();
  });

  it("uses the first accessible location", async () => {
    expect((await hrefs(ctx(ALL_PERMS, [{ id: "loc-a", name: "A" }, { id: "loc-b", name: "B" }]))).tables).toBe("loc-a/tables");
  });
});

describe("failure", () => {
  it("a read error shows nothing as done and does not throw", async () => {
    db.results = { ...fresh(), locations: { data: null, error: { message: "boom" } } };
    const p = await getSetupProgress(ctx());
    expect(p.completed).toBe(0);
    expect(p.steps).toHaveLength(5);
    expect(p.steps[0].href).toBe("settings"); // hrefs still come from ctx
  });
});
