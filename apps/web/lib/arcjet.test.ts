import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Stand-in for the validated env: like the real one, it throws in production when the key is missing.
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    get ARCJET_KEY() {
      const k = process.env.ARCJET_KEY;
      if (!k && process.env.NODE_ENV === "production") throw new Error("Invalid environment: ARCJET_KEY: missing");
      return k || undefined;
    },
  },
}));

const calls = { arcjet: [] as unknown[], rules: [] as unknown[] };
const protectFn = vi.fn();
const inst: { withRule: (r: unknown) => typeof inst; protect: typeof protectFn } = {
  withRule: (r) => (calls.rules.push(r), inst),
  protect: protectFn,
};
vi.mock("@arcjet/next", () => ({
  default: (o: unknown) => (calls.arcjet.push(o), inst),
  request: async () => ({ headers: {} }),
  shield: (o: unknown) => [{ type: "shield", ...(o as object) }],
  detectBot: (o: unknown) => [{ type: "bot", ...(o as object) }],
  slidingWindow: (o: unknown) => [{ type: "rate", ...(o as object) }],
  validateEmail: (o: unknown) => [{ type: "email", ...(o as object) }],
}));

const decision = (o: { denied?: boolean; errored?: boolean; kind?: "rate" | "bot" | "shield" | "email" }) => ({
  isErrored: () => !!o.errored,
  isDenied: () => !!o.denied,
  reason: {
    isRateLimit: () => o.kind === "rate",
    isBot: () => o.kind === "bot",
    isShield: () => o.kind === "shield",
    isEmail: () => o.kind === "email",
  },
});

async function load() {
  vi.resetModules();
  return import("./arcjet");
}

beforeEach(() => {
  calls.arcjet.length = 0;
  calls.rules.length = 0;
  protectFn.mockReset();
  vi.unstubAllEnvs();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("presets", () => {
  it("have the pinned shapes", async () => {
    const m = await load();
    expect(m.ajAuth).toMatchObject({ name: "auth", validatesEmail: false });
    expect(m.ajSignup).toMatchObject({ name: "signup", validatesEmail: true });
    expect(m.ajPublicForm.name).toBe("publicForm");
    expect(m.ajProbe.limit.max).toBeLessThanOrEqual(m.ajAuth.limit.max * 2);
    expect(m.ajSignup.limit.max).toBeLessThan(m.ajAuth.limit.max);
  });
});

describe("protect", () => {
  it("without ARCJET_KEY: allowed, warns once, never builds a client", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    const m = await load();
    expect(await m.protect(m.ajAuth)).toEqual({ allowed: true });
    expect(await m.protect(m.ajSignup, { email: "a@b.co" })).toEqual({ allowed: true });
    expect(calls.arcjet).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("builds ONE shared base (shield) and adds bot + rate rules per preset; DRY_RUN outside production", async () => {
    vi.stubEnv("ARCJET_KEY", "ajkey_test");
    vi.stubEnv("NODE_ENV", "test");
    protectFn.mockResolvedValue(decision({}));
    const m = await load();
    await m.protect(m.ajAuth);
    await m.protect(m.ajProbe);
    expect(calls.arcjet).toHaveLength(1);
    expect(calls.arcjet[0]).toMatchObject({ key: "ajkey_test", rules: [[{ type: "shield", mode: "DRY_RUN" }]] });
    expect(calls.rules).toContainEqual([{ type: "rate", mode: "DRY_RUN", interval: "1m", max: 10 }]);
  });

  it("is LIVE in production and signup adds email validation + passes the email", async () => {
    vi.stubEnv("ARCJET_KEY", "ajkey_test");
    vi.stubEnv("NODE_ENV", "production");
    protectFn.mockResolvedValue(decision({}));
    const m = await load();
    await m.protect(m.ajSignup, { email: "x@mailinator.com" });
    expect(calls.rules).toContainEqual([{ type: "email", mode: "LIVE", deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"] }]);
    expect(protectFn).toHaveBeenCalledWith({ headers: {} }, { email: "x@mailinator.com" });
  });

  it.each([
    ["rate", "RATE_LIMITED"],
    ["bot", "BOT"],
    ["shield", "SHIELD"],
    ["email", "EMAIL_INVALID"],
  ] as const)("maps a denied %s decision to %s", async (kind, reason) => {
    vi.stubEnv("ARCJET_KEY", "k");
    protectFn.mockResolvedValue(decision({ denied: true, kind }));
    const m = await load();
    expect(await m.protect(m.ajAuth)).toEqual({ allowed: false, reason });
  });

  it("fails open on errored decisions and thrown errors", async () => {
    vi.stubEnv("ARCJET_KEY", "k");
    const m = await load();
    protectFn.mockResolvedValueOnce(decision({ errored: true, denied: true }));
    expect(await m.protect(m.ajAuth)).toEqual({ allowed: true });
    protectFn.mockRejectedValueOnce(new Error("network"));
    expect(await m.protect(m.ajAuth)).toEqual({ allowed: true });
  });
});

describe("production misconfiguration", () => {
  it("fails fast when ARCJET_KEY is missing in production (no silent allow)", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const m = await load();
    await expect(m.protect(m.ajAuth)).rejects.toThrow(/ARCJET_KEY/);
    await expect(m.shieldRequest({})).rejects.toThrow(/ARCJET_KEY/);
  });
});

describe("proxy shield", () => {
  it("shields public + auth paths only, never the webhook or the app areas", async () => {
    const { isShieldedPath } = await load();
    for (const p of ["/", "/login", "/signup", "/invite/abc", "/pricing", "/s/demo", "/onboarding", "/auth/confirm"]) {
      expect(isShieldedPath(p)).toBe(true);
    }
    for (const p of ["/api/webhooks/doku", "/demo/pos", "/admin/tenants", "/loginx", "/sx"]) {
      expect(isShieldedPath(p)).toBe(false);
    }
  });
  it("returns 403 on deny, null otherwise or without a key", async () => {
    vi.stubEnv("ARCJET_KEY", "");
    let m = await load();
    expect(await m.shieldRequest({})).toBeNull();
    vi.stubEnv("ARCJET_KEY", "k");
    m = await load();
    protectFn.mockResolvedValueOnce(decision({ denied: true, kind: "shield" }));
    expect((await m.shieldRequest({}))?.status).toBe(403);
    protectFn.mockResolvedValueOnce(decision({}));
    expect(await m.shieldRequest({})).toBeNull();
  });
});
