import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const tags: string[] = [];
vi.mock("next/cache", () => ({ cacheTag: (...t: string[]) => tags.push(...t), cacheLife: () => {} }));

const calls: { rpc?: [string, unknown]; table?: string; filters: [string, unknown][] } = { filters: [] };
let result: { data: unknown; error: { message: string } | null } = { data: [], error: null };
vi.mock("@/lib/supabase/anon", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => (calls.filters.push([c, v]), q);
  q.order = () => q;
  q.then = (res: (v: unknown) => unknown) => res(result);
  return {
    createAnonClient: () => ({
      from: (t: string) => ((calls.table = t), q),
      rpc: (n: string, a: unknown) => ((calls.rpc = [n, a]), Promise.resolve(result)),
    }),
  };
});

import { getPublicPackages, mapPackages } from "./packages";
import { getStorefront, parseStorefront } from "../storefront/get-storefront";

const pkg = (o: Record<string, unknown> = {}) => ({
  code: "pro", name: "Pro", description: null, currency: "IDR", price_monthly: 100000, price_yearly: "1000000",
  trial_days: 14, limits: { locations: 3, staff: null }, features: ["qr_ordering"], is_default: false, sort_order: 2, ...o,
});

beforeEach(() => {
  tags.length = 0;
  calls.filters = [];
  calls.rpc = undefined;
  result = { data: [], error: null };
});

describe("packages", () => {
  it("maps, coerces numeric strings and orders by sort_order then price", () => {
    const out = mapPackages([pkg({ code: "b", sort_order: 1, price_monthly: 5 }), pkg({ code: "a", sort_order: 1, price_monthly: 1 }), pkg({ code: "z", sort_order: 0, price_monthly: 999 })]);
    expect(out.map((p) => p.code)).toEqual(["z", "a", "b"]);
    expect(out[0]).toMatchObject({ priceYearly: 1000000, isDefault: false, trialDays: 14 });
  });
  it("rejects malformed rows", () => {
    expect(() => mapPackages([pkg({ limits: { a: "x" } })])).toThrow();
    expect(() => mapPackages([{ code: "x" }])).toThrow();
  });
  it("queries active+public only, tags 'packages'", async () => {
    result = { data: [pkg()], error: null };
    const out = await getPublicPackages();
    expect(out).toHaveLength(1);
    expect(calls.table).toBe("packages");
    expect(calls.filters).toEqual([["is_active", true], ["is_public", true]]);
    expect(tags).toEqual(["packages"]);
  });
  it("throws on a DB error", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(getPublicPackages()).rejects.toThrow("boom");
  });
});

describe("storefront", () => {
  const active = {
    status: "active", name: "Demo", slug: "demo",
    branding: { logo_url: "https://cdn.example.com/l.png", primary_color: "#112233", secondary_color: null, font: "Inter", theme: { a: 1 } },
    locations: [{ name: "Kemang", address: "Jl", city: "Jakarta", phone: null, timezone: "Asia/Jakarta" }, { name: "B", timezone: "Asia/Jakarta" }],
  };
  it("maps an active storefront", () => {
    const s = parseStorefront(active);
    expect(s).toMatchObject({ status: "active", name: "Demo", slug: "demo" });
    expect(s && s.status === "active" && s.branding).toEqual({ logoUrl: "https://cdn.example.com/l.png", primaryColor: "#112233", secondaryColor: null, font: "Inter", theme: { a: 1 } });
    expect(s && s.status === "active" && s.locations[1]).toEqual({ name: "B", address: null, city: null, phone: null, timezone: "Asia/Jakarta" });
  });
  it("handles empty branding, null and unavailable", () => {
    const s = parseStorefront({ ...active, branding: {} });
    expect(s && s.status === "active" && s.branding).toMatchObject({ logoUrl: null, primaryColor: null, theme: {} });
    expect(parseStorefront(null)).toBeNull();
    expect(parseStorefront({ status: "unavailable" })).toEqual({ status: "unavailable" });
  });
  it("drops non-https logos", () => {
    const s = parseStorefront({ ...active, branding: { logo_url: "javascript:alert(1)" } });
    expect(s && s.status === "active" && s.branding.logoUrl).toBeNull();
  });
  it("rejects malformed RPC output", () => {
    expect(() => parseStorefront({ status: "active", name: "x" })).toThrow();
    expect(() => parseStorefront({ status: "weird" })).toThrow();
  });
  it("normalises the slug, tags it, and never queries for invalid slugs", async () => {
    result = { data: active, error: null };
    await getStorefront("  DEMO ");
    expect(calls.rpc).toEqual(["get_storefront", { slug: "demo" }]);
    expect(tags).toEqual(["storefront:demo"]);
    calls.rpc = undefined;
    expect(await getStorefront("bad slug; drop")).toBeNull();
    expect(await getStorefront("")).toBeNull();
    expect(calls.rpc).toBeUndefined();
  });
});
