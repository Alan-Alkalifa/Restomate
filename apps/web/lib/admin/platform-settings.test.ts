import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class NotFound extends Error {}
type Reply = { data?: unknown; error?: { code?: string; message: string } | null };
const state = { admin: true, calls: [] as [string, Record<string, unknown>][], reply: { data: true, error: null } as Reply };
const updateTag = vi.fn();
const capture = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t), cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));
vi.mock("@/lib/auth/dal", () => ({
  requirePlatformAdmin: async () => {
    if (!state.admin) throw new NotFound();
    return { id: "admin-1", email: "a@x.test" };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push([fn, args]);
      return state.reply;
    },
  }),
}));
const anonRpc = vi.fn();
vi.mock("@/lib/supabase/anon", () => ({ createAnonClient: () => ({ rpc: (...a: unknown[]) => anonRpc(...a) }) }));

import { updateMaintenanceBanner, updateOwnedOrgCap, updateSignup, updateTaxPresets } from "./settings-actions";
import { getPlatformSettings } from "./platform-settings";
import { getPublicPlatformFlags, isSignupEnabled } from "@/lib/public/platform-flags";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const preset = { code: "pb1_8", label: "PB1 8%", taxRateBps: 800, serviceChargeBps: 250, taxOnServiceCharge: false };
const presetsForm = (over: Record<string, unknown> = {}, list: unknown[] = [preset]) =>
  fd({ presets: JSON.stringify(list.map((p) => ({ ...(p as object), ...over }))), defaultCode: "pb1_8" });

beforeEach(() => {
  state.admin = true;
  state.calls = [];
  state.reply = { data: true, error: null };
  updateTag.mockClear();
  capture.mockClear();
  anonRpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("auth", () => {
  it("every action is notFound for non-admins, before touching the database", async () => {
    state.admin = false;
    for (const call of [
      () => updateSignup(null, fd({ enabled: "false" })),
      () => updateMaintenanceBanner(null, fd({ enabled: "false", message: "", level: "info" })),
      () => updateTaxPresets(null, presetsForm()),
      () => updateOwnedOrgCap(null, fd({ max: "3" })),
      () => getPlatformSettings(),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFound);
    }
    expect(state.calls).toEqual([]);
  });
});

describe("writes", () => {
  it("updateSignup sends the typed value, then updateTag + PostHog { key } only", async () => {
    expect(await updateSignup(null, fd({ enabled: "false" }))).toEqual({ ok: true });
    expect(state.calls[0]).toEqual(["admin_update_platform_setting", { key: "signup", value: { enabled: false } }]);
    expect(updateTag).toHaveBeenCalledWith("platform-flags");
    expect(capture).toHaveBeenCalledWith("platform_setting_updated", { distinctId: "admin-1", properties: { key: "signup" } });
  });

  it("a no-op (RPC returns false) is ok but refreshes nothing and sends no event", async () => {
    state.reply = { data: false, error: null };
    expect(await updateSignup(null, fd({ enabled: "true" }))).toEqual({ ok: true });
    expect(updateTag).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("a failed write refreshes nothing and maps the error", async () => {
    state.reply = { data: null, error: { code: "42501", message: "FORBIDDEN" } };
    expect(await updateSignup(null, fd({ enabled: "false" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    state.reply = { data: null, error: { code: "P0001", message: "INVALID_SETTING" } };
    expect(await updateSignup(null, fd({ enabled: "false" }))).toEqual({ ok: false, formError: "That value isn't allowed." });
    state.reply = { data: null, error: { code: "XX000", message: "db down" } };
    expect(await updateSignup(null, fd({ enabled: "false" }))).toEqual({ ok: false, formError: "Could not save the setting. Try again." });
    expect(updateTag).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("never sends values or the banner text to PostHog", async () => {
    await updateMaintenanceBanner(null, fd({ enabled: "true", message: "Secret maintenance note", level: "warning" }));
    expect(JSON.stringify(capture.mock.calls)).not.toContain("Secret");
    expect(state.calls[0][1]).toEqual({ key: "maintenance_banner", value: { enabled: true, message: "Secret maintenance note", level: "warning" } });
  });

  it("updateOwnedOrgCap and updateTaxPresets send the typed values", async () => {
    await updateOwnedOrgCap(null, fd({ max: "5" }));
    await updateTaxPresets(null, presetsForm());
    expect(state.calls[0][1]).toEqual({ key: "owned_org_cap", value: { max: 5 } });
    expect(state.calls[1][1]).toEqual({ key: "tax_presets", value: { presets: [preset], defaultCode: "pb1_8" } });
  });
});

describe("validation (no RPC call, no cache refresh)", () => {
  const expectRejected = async (r: Promise<unknown>) => {
    expect(await r).toMatchObject({ ok: false });
    expect(state.calls).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  };

  it("signup: non-boolean and unknown fields", async () => {
    await expectRejected(updateSignup(null, fd({ enabled: "maybe" })));
    await expectRejected(updateSignup(null, fd({ enabled: "true", extra: "1" })));
  });

  it.each([
    ["too long", { enabled: "true", message: "a".repeat(201), level: "info" }],
    ["angle brackets", { enabled: "true", message: "<script>alert(1)</script>", level: "info" }],
    ["control character", { enabled: "true", message: "line1\nline2", level: "info" }],
    ["enabled but empty", { enabled: "true", message: "   ", level: "info" }],
    ["bad level", { enabled: "true", message: "x", level: "error" }],
  ])("banner: %s", async (_n, body) => {
    await expectRejected(updateMaintenanceBanner(null, fd(body)));
  });

  it("banner: a disabled banner may have an empty message", async () => {
    expect(await updateMaintenanceBanner(null, fd({ enabled: "false", message: "", level: "info" }))).toEqual({ ok: true });
  });

  it.each([
    ["rate above 10000", { taxRateBps: 10001 }],
    ["fractional rate", { taxRateBps: 10.5 }],
    ["negative rate", { serviceChargeBps: -1 }],
    ["rate as a string", { taxRateBps: "1000" }],
    ["bad code", { code: "PB1 8" }],
    ["unknown preset field", { extra: true }],
  ])("tax presets: %s", async (_n, over) => {
    await expectRejected(updateTaxPresets(null, presetsForm(over)));
  });

  it("tax presets: duplicate codes, missing default, empty list, bad JSON, oversize, unknown field", async () => {
    await expectRejected(updateTaxPresets(null, presetsForm({}, [preset, preset])));
    await expectRejected(updateTaxPresets(null, fd({ presets: JSON.stringify([preset]), defaultCode: "nope" })));
    await expectRejected(updateTaxPresets(null, fd({ presets: "[]", defaultCode: "pb1_8" })));
    await expectRejected(updateTaxPresets(null, fd({ presets: "{not json", defaultCode: "pb1_8" })));
    await expectRejected(updateTaxPresets(null, fd({ presets: " ".repeat(9000) + "[]", defaultCode: "x" })));
    await expectRejected(updateTaxPresets(null, fd({ presets: JSON.stringify([preset]), defaultCode: "pb1_8", extra: "1" })));
    const many = Array.from({ length: 21 }, (_, i) => ({ ...preset, code: `p${i}x` }));
    await expectRejected(updateTaxPresets(null, fd({ presets: JSON.stringify(many), defaultCode: "p0x" })));
  });

  it("tax presets: errors name the failing preset", async () => {
    const r = await updateTaxPresets(null, presetsForm({}, [preset, { ...preset, code: "b2", taxRateBps: 10001 }]));
    expect(r.ok === false && r.fieldErrors?.presets?.[0]).toMatch(/^Preset 2:/);
  });

  it.each(["0", "101", "2.5", "-1", "abc", "1e2", ""])("owned org cap rejects %j", async (max) => {
    await expectRejected(updateOwnedOrgCap(null, fd({ max })));
  });
});

describe("public flags", () => {
  const banner = { enabled: true, message: "Back soon", level: "info" };

  it("getPublicPlatformFlags returns the two flags", async () => {
    anonRpc.mockResolvedValue({ data: { signupEnabled: false, maintenanceBanner: banner }, error: null });
    expect(await getPublicPlatformFlags()).toEqual({ signupEnabled: false, maintenanceBanner: banner });
    expect(anonRpc).toHaveBeenCalledWith("get_public_platform_flags");
  });

  it("falls back (signup on, no banner) and never throws when the call fails", async () => {
    anonRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await getPublicPlatformFlags()).toEqual({ signupEnabled: true, maintenanceBanner: null });
    expect(await isSignupEnabled()).toBe(true);
  });

  it("isSignupEnabled reads the live value", async () => {
    anonRpc.mockResolvedValue({ data: { signupEnabled: false, maintenanceBanner: null }, error: null });
    expect(await isSignupEnabled()).toBe(false);
  });
});
