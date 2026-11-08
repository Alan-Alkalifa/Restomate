import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Redirect(u); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
const protect = vi.fn();
vi.mock("@/lib/arcjet", () => ({ ajAuth: { name: "auth" }, ajProbe: { name: "probe" }, protect: (...a: unknown[]) => protect(...a) }));
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => ({ id: "u-1", email: "a@x.test" }), getCurrentUser: () => getCurrentUser() }));
const capture = vi.fn();
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));
const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}));

import { checkSlug, createOrganization } from "./actions";

const input = {
  name: "Warung Sedap",
  slug: "warung-sedap",
  location: { name: "Main", address: "", city: "", phone: "", timezone: "Asia/Jakarta", currency: "IDR", taxRateBps: 1000, serviceChargeBps: 0, taxOnServiceCharge: true },
  branding: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  protect.mockResolvedValue({ allowed: true });
  getCurrentUser.mockResolvedValue({ id: "u-1", email: "a@x.test" });
  maybeSingle.mockResolvedValue({ data: null, error: null });
  rpc.mockResolvedValue({ data: { organization_id: "o-1", slug: "warung-sedap" }, error: null });
});

describe("checkSlug", () => {
  it("invalid for bad format without touching the DB", async () => {
    expect(await checkSlug("-x")).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reserved, taken, available", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { slug: "demo" } });
    expect(await checkSlug("demo")).toEqual({ status: "reserved" });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkSlug("taken-one")).toEqual({ status: "taken" });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkSlug("free-one")).toEqual({ status: "available" });
  });
  it("requires a signed-in user and never says available on a failed lookup", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await checkSlug("free-one")).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
    getCurrentUser.mockResolvedValue({ id: "u-1" });
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    expect(await checkSlug("free-one")).toEqual({ status: "invalid" });
  });
  it("is rate limited", async () => {
    protect.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await checkSlug("free-one")).toEqual({ status: "invalid" });
  });
});

describe("createOrganization", () => {
  it("calls the RPC once with snake_case location, no org id/role/package, tags, captures and redirects", async () => {
    await expect(createOrganization({ ...input, organization_id: "evil", package_code: "enterprise" } as never)).rejects.toMatchObject({ url: "/warung-sedap" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("create_organization");
    expect(Object.keys(args).sort()).toEqual(["branding", "location", "name", "slug"]);
    expect(args.location).toMatchObject({ tax_rate_bps: 1000, service_charge_bps: 0, tax_on_service_charge: true });
    expect(updateTag).toHaveBeenCalledWith("member:u-1:o-1");
    expect(capture).toHaveBeenCalledWith("onboarding_completed", { distinctId: "u-1", organizationId: "o-1" });
    expect(capture).toHaveBeenCalledWith("trial_started", { distinctId: "u-1", organizationId: "o-1" });
  });
  it("re-validates server-side with dotted field errors", async () => {
    const r = await createOrganization({ ...input, location: { ...input.location, taxRateBps: 9999 } });
    expect(r).toMatchObject({ ok: false, fieldErrors: { "location.taxRateBps": [expect.any(String)] } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "SLUG_TAKEN" } });
    expect(await createOrganization(input)).toMatchObject({ ok: false, fieldErrors: { slug: [expect.any(String)] } });
    rpc.mockResolvedValue({ data: null, error: { message: "ORG_LIMIT_REACHED" } });
    expect(await createOrganization(input)).toMatchObject({ ok: false, code: "PLAN_LIMIT" });
    expect(capture).not.toHaveBeenCalled();
  });
  it("is rate limited", async () => {
    protect.mockResolvedValue({ allowed: false, reason: "RATE_LIMITED" });
    expect(await createOrganization(input)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
