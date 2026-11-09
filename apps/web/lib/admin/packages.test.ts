import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class NotFound extends Error {}
const state = {
  admin: true,
  rpcCalls: [] as [string, Record<string, unknown>][],
  rpc: {} as Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>,
};
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/posthog/server", () => ({ captureServer: vi.fn() }));
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

import { archivePackage, createPackage, setDefaultPackage, updatePackage } from "./package-actions";
import { mapAdminPackages } from "./packages";

const ID = "0b0f3e0e-8f6b-4b43-9a53-3a3f3f3f3f3f";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const plan = {
  name: "Growth",
  description: "",
  currency: "IDR",
  priceMonthly: "250000",
  priceYearly: "2500000",
  trialDays: "14",
  limit_max_locations: "3",
  limit_max_staff: "",
  limit_max_tables: "60",
  limit_max_orders_per_month: "",
  features: ["qr_ordering", "reservations", "qr_ordering"],
  isPublic: "true",
  sortOrder: "2",
};

beforeEach(() => {
  state.admin = true;
  state.rpcCalls = [];
  state.rpc = {};
  updateTag.mockClear();
});

describe("auth", () => {
  it("rejects non-platform-admins before touching the database", async () => {
    state.admin = false;
    for (const call of [
      () => createPackage(null, fd({ code: "growth", ...plan })),
      () => updatePackage(null, fd({ packageId: ID, ...plan })),
      () => archivePackage(null, fd({ packageId: ID, archived: "true" })),
      () => setDefaultPackage(null, fd({ packageId: ID })),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFound);
    }
    expect(state.rpcCalls).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  const bad = async (over: Record<string, string | string[]>) => {
    const r = await createPackage(null, fd({ code: "growth", ...plan, ...over }));
    expect(r.ok).toBe(false);
    expect(state.rpcCalls).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
    return r;
  };
  it.each(["10.5", "-1", "1e3", "1,000", " ", "abc", "99999999999999999"])("rejects price %j", async (v) => {
    await bad({ priceMonthly: v });
  });
  it("rejects trial days out of range", async () => {
    await bad({ trialDays: "366" });
    await bad({ trialDays: "-1" });
  });
  it("rejects unknown features", async () => {
    await bad({ features: ["qr_ordering", "teleport"] });
  });
  it("rejects unknown limit keys", async () => {
    await bad({ limit_max_bogus: "1" });
  });
  it("rejects negative or fractional limits", async () => {
    await bad({ limit_max_tables: "-5" });
    await bad({ limit_max_tables: "1.5" });
  });
  it("rejects bad codes and currencies", async () => {
    await bad({ code: "Growth" });
    await bad({ code: "x" });
    await bad({ currency: "EUR" });
  });
});

describe("writes", () => {
  it("createPackage sends minor-unit integers, null for unlimited, deduped features, then updateTag", async () => {
    expect(await createPackage(null, fd({ code: "growth", ...plan }))).toEqual({ ok: true });
    const [fn, args] = state.rpcCalls[0];
    expect(fn).toBe("admin_create_package");
    expect(args.input).toMatchObject({
      code: "growth",
      price_monthly: 250000,
      price_yearly: 2500000,
      trial_days: 14,
      description: null,
      limits: { max_locations: 3, max_staff: null, max_tables: 60, max_orders_per_month: null },
      features: ["qr_ordering", "reservations"],
    });
    expect(updateTag).toHaveBeenCalledWith("packages");
  });

  it("updatePackage / archive / setDefault call updateTag('packages') on success", async () => {
    await updatePackage(null, fd({ packageId: ID, ...plan }));
    await archivePackage(null, fd({ packageId: ID, archived: "true" }));
    await setDefaultPackage(null, fd({ packageId: ID }));
    expect(state.rpcCalls.map(([f]) => f)).toEqual(["admin_update_package", "admin_set_package_active", "admin_set_default_package"]);
    expect(state.rpcCalls[1][1]).toEqual({ package_id: ID, active: false });
    expect(updateTag).toHaveBeenCalledTimes(3);
    expect(updateTag).toHaveBeenCalledWith("packages");
  });

  it("restore passes active=true", async () => {
    await archivePackage(null, fd({ packageId: ID, archived: "false" }));
    expect(state.rpcCalls[0][1]).toEqual({ package_id: ID, active: true });
  });

  it("does not updateTag when the RPC fails, and maps error codes", async () => {
    const cases: [string, { code?: string; message: string }, string | undefined][] = [
      ["admin_create_package", { code: "23505", message: "dup" }, "DUPLICATE_CODE"],
      ["admin_create_package", { code: "42501", message: "FORBIDDEN" }, "FORBIDDEN"],
      ["admin_create_package", { code: "P0001", message: "PACKAGE_NOT_FOUND" }, "NOT_FOUND"],
      ["admin_create_package", { code: "P0001", message: "PACKAGE_IN_USE" }, "PACKAGE_IN_USE"],
      ["admin_create_package", { code: "P0001", message: "DEFAULT_PACKAGE" }, "DEFAULT_PACKAGE"],
      ["admin_create_package", { code: "P0001", message: "PACKAGE_INACTIVE" }, "PACKAGE_INACTIVE"],
      ["admin_create_package", { message: "boom" }, undefined],
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [fn, error, code] of cases) {
      state.rpc = { [fn]: { error } };
      const r = await createPackage(null, fd({ code: "growth", ...plan }));
      expect(r).toMatchObject({ ok: false });
      expect((r as { code?: string }).code).toBe(code);
    }
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("mapAdminPackages", () => {
  it("fills every limit key, drops unknown features, reads the subscription count", () => {
    const [p] = mapAdminPackages([
      {
        id: ID, code: "x", name: "X", description: null, currency: "IDR", price_monthly: "100", price_yearly: 1000,
        trial_days: 0, limits: { max_tables: 5 }, features: ["qr_ordering", "legacy"], is_active: false,
        is_public: false, is_default: false, sort_order: 1, created_at: "t", updated_at: "t", subscriptions: [{ count: 3 }],
      },
    ]);
    expect(p.limits).toEqual({ max_locations: null, max_staff: null, max_tables: 5, max_orders_per_month: null });
    expect(p.features).toEqual(["qr_ordering"]);
    expect(p.subscriptionCount).toBe(3);
    expect(p.priceMonthly).toBe(100);
  });

  it("a stored plan without max_orders_per_month (like the seed) reads as null = unlimited", () => {
    const [p] = mapAdminPackages([
      {
        id: ID, code: "starter", name: "Starter", description: null, currency: "IDR", price_monthly: 100000,
        price_yearly: 1000000, trial_days: 14, limits: { max_locations: 1, max_staff: 5, max_tables: 20 }, features: [],
        is_active: true, is_public: true, is_default: false, sort_order: 1, created_at: "t", updated_at: "t",
      },
    ]);
    expect(p.limits.max_orders_per_month).toBeNull();
    expect(p.limits).toEqual({ max_locations: 1, max_staff: 5, max_tables: 20, max_orders_per_month: null });
    expect(p.subscriptionCount).toBe(0);
  });
});
