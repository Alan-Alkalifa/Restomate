import { afterEach, describe, expect, it, vi } from "vitest";
import { assertVercelBuildEnv, ENV_SLICES, EnvError, envSliceSchemas, parseEnv, PRODUCTION_REQUIRED, publicEnvSchema, serverEnvSchema, sliceOfEnvKey } from "./env";

const PUBLIC = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key-value",
};
const SERVER = { ...PUBLIC, SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value" };
const PROD = {
  EMAIL_DELIVERY: "resend",
  EMAIL_FROM: "Restomate <no-reply@mail.restomate.app>",
  ARCJET_KEY: "aj",
  RESEND_API_KEY: "re_x",
  DOKU_CLIENT_ID: "BRN-1",
  DOKU_SECRET_KEY: "doku-secret",
  APP_ENCRYPTION_KEY: "ab".repeat(32),
};

function errorOf(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (e) {
    return e as EnvError;
  }
  throw new Error("expected EnvError");
}

describe("parseEnv", () => {
  it("accepts a valid public env and trims/lowercases the root domain", () => {
    const env = parseEnv(publicEnvSchema, { ...PUBLIC, NEXT_PUBLIC_ROOT_DOMAIN: " Restomate.App " });
    expect(env.NEXT_PUBLIC_ROOT_DOMAIN).toBe("restomate.app");
  });

  it("names every missing variable and never prints values", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, { NEXT_PUBLIC_APP_URL: "http://secret-host.test" }));
    expect(e).toBeInstanceOf(EnvError);
    expect(e.names).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_ROOT_DOMAIN",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ]),
    );
    expect(e.message).toContain("SUPABASE_SERVICE_ROLE_KEY (missing)");
    expect(e.message).not.toContain("secret-host");
  });

  it("reports invalid values by name without echoing them", () => {
    const e = errorOf(() => parseEnv(publicEnvSchema, { ...PUBLIC, NEXT_PUBLIC_SUPABASE_URL: "not a url super-secret" }));
    expect(e.names).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(e.message).not.toContain("super-secret");
  });

  it("treats empty strings as unset", () => {
    expect(errorOf(() => parseEnv(publicEnvSchema, { ...PUBLIC, NEXT_PUBLIC_APP_URL: "" })).names).toEqual([
      "NEXT_PUBLIC_APP_URL",
    ]);
  });

  it("rejects a root domain with a scheme or port", () => {
    expect(errorOf(() => parseEnv(publicEnvSchema, { ...PUBLIC, NEXT_PUBLIC_ROOT_DOMAIN: "https://restomate.app" })).names).toEqual([
      "NEXT_PUBLIC_ROOT_DOMAIN",
    ]);
  });
});

describe("Supabase client key", () => {
  const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _drop, ...BASE } = PUBLIC;
  void _drop;

  it("accepts only PUBLISHABLE_KEY", () => {
    expect(parseEnv(publicEnvSchema, { ...BASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub" }).supabasePublishableKey).toBe("pub");
  });
  it("accepts only the legacy ANON_KEY", () => {
    expect(parseEnv(publicEnvSchema, { ...BASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }).supabasePublishableKey).toBe("anon");
  });
  it("prefers PUBLISHABLE_KEY when both are set", () => {
    const env = parseEnv(serverEnvSchema, {
      ...SERVER,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(env.supabasePublishableKey).toBe("pub");
  });
  it("treats an empty PUBLISHABLE_KEY as unset and falls back", () => {
    expect(
      parseEnv(publicEnvSchema, { ...BASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }).supabasePublishableKey,
    ).toBe("anon");
  });
  it("fails with neither, naming both variables and no values", () => {
    const e = errorOf(() => parseEnv(publicEnvSchema, { ...BASE, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }));
    expect(e.names).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(e.message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(e.message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(e.message).not.toContain("127.0.0.1");
  });
});

describe("server env defaults and production rules", () => {
  it("dev defaults: EMAIL_DELIVERY=log, DOKU_ENV=sandbox, optional integrations absent", () => {
    const env = parseEnv(serverEnvSchema, SERVER);
    expect(env.EMAIL_DELIVERY).toBe("log");
    expect(env.DOKU_ENV).toBe("sandbox");
    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  it("production requires DOKU/Resend/Arcjet/encryption key", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, SERVER, { production: true, requireInProduction: PRODUCTION_REQUIRED }));
    expect(e.names).toEqual([...PRODUCTION_REQUIRED]);
    expect(e.message).toContain("required in production");
  });

  it("production passes when everything is set", () => {
    const env = parseEnv(serverEnvSchema, { ...SERVER, ...PROD }, { production: true, requireInProduction: PRODUCTION_REQUIRED });
    expect(env.EMAIL_DELIVERY).toBe("resend");
  });

  const prod = { production: true, requireInProduction: PRODUCTION_REQUIRED } as const;

  it("production with EMAIL_DELIVERY unset fails and names EMAIL_DELIVERY", () => {
    const { EMAIL_DELIVERY: _omit, ...rest } = PROD;
    void _omit;
    const e = errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, ...rest }, prod));
    expect(e.names).toEqual(["EMAIL_DELIVERY"]);
  });

  it("production with EMAIL_DELIVERY=log fails", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, ...PROD, EMAIL_DELIVERY: "log" }, prod));
    expect(e.names).toEqual(["EMAIL_DELIVERY"]);
    expect(e.message).toContain("resend");
  });

  it("resend without RESEND_API_KEY or EMAIL_FROM fails in any environment", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, EMAIL_DELIVERY: "resend" }));
    expect(e.names.sort()).toEqual(["EMAIL_FROM", "RESEND_API_KEY"]);
    expect(() => parseEnv(serverEnvSchema, { ...SERVER, EMAIL_DELIVERY: "resend", RESEND_API_KEY: "re_x", EMAIL_FROM: "A <a@b.test>" })).not.toThrow();
  });

  it("dev/test with nothing set defaults to log without error; log is allowed outside production", () => {
    expect(parseEnv(serverEnvSchema, SERVER).EMAIL_DELIVERY).toBe("log");
    expect(parseEnv(serverEnvSchema, { ...SERVER, EMAIL_DELIVERY: "log" }).EMAIL_DELIVERY).toBe("log");
  });

  it("error messages never contain secret values", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, EMAIL_DELIVERY: "log", RESEND_API_KEY: "re_super_secret" }, prod));
    expect(e.message).not.toContain("re_super_secret");
    expect(e.message).not.toContain("service-role-secret-value");
  });

  it("validates the encryption key length (hex or base64, 32 bytes)", () => {
    const ok = Buffer.alloc(32, 7).toString("base64");
    expect(parseEnv(serverEnvSchema, { ...SERVER, APP_ENCRYPTION_KEY: ok }).APP_ENCRYPTION_KEY).toBe(ok);
    expect(errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, APP_ENCRYPTION_KEY: "short" })).names).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("rejects bad enum values", () => {
    expect(errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, DOKU_ENV: "live" })).names).toEqual(["DOKU_ENV"]);
  });
});

describe("env slices are validated independently", () => {
  const BAD = { DOKU_ENV: "banana", APP_ENCRYPTION_KEY: "too-short" };
  const slice = (name: keyof typeof ENV_SLICES, source: Record<string, string>, production = false): Record<string, string | undefined> =>
    parseEnv(envSliceSchemas[name], source, {
      production,
      requireInProduction: PRODUCTION_REQUIRED.filter((k) => (ENV_SLICES[name] as readonly string[]).includes(k)),
      emailRules: name === "email",
    });

  it("a bad DOKU_ENV and APP_ENCRYPTION_KEY do not break the email, public or supabaseAdmin slices", () => {
    const src = { ...SERVER, ...PROD, ...BAD };
    expect(slice("email", src, true).EMAIL_DELIVERY).toBe("resend");
    expect(slice("public", src, true).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(slice("supabaseAdmin", src, true).SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-secret-value");
  });

  it("each bad slice names only its own variable, never the value", () => {
    const src = { ...SERVER, ...PROD, ...BAD };
    const doku = errorOf(() => slice("doku", src, true));
    expect(doku.names).toEqual(["DOKU_ENV"]);
    const enc = errorOf(() => slice("encryption", src, true));
    expect(enc.names).toEqual(["APP_ENCRYPTION_KEY"]);
    expect(doku.message + enc.message).not.toContain("banana");
    expect(doku.message + enc.message).not.toContain("too-short");
  });

  it("the full env still reports every bad variable at once", () => {
    const e = errorOf(() => parseEnv(serverEnvSchema, { ...SERVER, ...PROD, ...BAD }, { production: true, requireInProduction: PRODUCTION_REQUIRED }));
    expect(e.names).toEqual(expect.arrayContaining(["DOKU_ENV", "APP_ENCRYPTION_KEY"]));
  });

  it("email rules apply to the email slice only", () => {
    // EMAIL_DELIVERY=log in production is wrong for the email slice, but must not be reported by the doku slice
    const src = { ...SERVER, ...PROD, EMAIL_DELIVERY: "log" };
    expect(errorOf(() => slice("email", src, true)).names).toEqual(["EMAIL_DELIVERY"]);
    expect(slice("doku", src, true).DOKU_ENV).toBe("sandbox");
  });

  it("production requires each slice's own secrets", () => {
    expect(errorOf(() => slice("doku", SERVER, true)).names).toEqual(["DOKU_CLIENT_ID", "DOKU_SECRET_KEY"]);
    expect(errorOf(() => slice("encryption", SERVER, true)).names).toEqual(["APP_ENCRYPTION_KEY"]);
  });

  it("maps every server variable to exactly one slice", () => {
    for (const key of ["EMAIL_FROM", "RESEND_API_KEY", "DOKU_SECRET_KEY", "APP_ENCRYPTION_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ARCJET_KEY", "NEXT_PUBLIC_APP_URL", "supabasePublishableKey"]) {
      expect(sliceOfEnvKey(key)).toBeDefined();
    }
    expect(sliceOfEnvKey("then")).toBeUndefined();
    const all = Object.values(ENV_SLICES).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("serverEnv (per-slice proxy) and boot validation", () => {
  const BASE = { ...SERVER, ...PROD, DOKU_ENV: "sandbox" };
  const setEnv = (vars: Record<string, string>, nodeEnv = "production") => {
    vi.unstubAllEnvs();
    for (const k of Object.keys(process.env)) if (k in BASE || k.startsWith("NEXT_PUBLIC_")) vi.stubEnv(k, "");
    vi.stubEnv("NODE_ENV", nodeEnv);
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });
  const load = async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    return import("./env.server");
  };

  it("reading an email variable works while DOKU_ENV and APP_ENCRYPTION_KEY are invalid", async () => {
    setEnv({ ...BASE, DOKU_ENV: "banana", APP_ENCRYPTION_KEY: "short" });
    const { serverEnv } = await load();
    expect(serverEnv.EMAIL_DELIVERY).toBe("resend");
    expect(serverEnv.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(() => serverEnv.DOKU_ENV).toThrow(/DOKU_ENV/);
    expect(() => serverEnv.APP_ENCRYPTION_KEY).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("validateServerEnv fails naming both variables, without values", async () => {
    setEnv({ ...BASE, DOKU_ENV: "banana", APP_ENCRYPTION_KEY: "short" });
    const { validateServerEnv } = await load();
    const e = errorOf(() => validateServerEnv());
    expect(e.names).toEqual(expect.arrayContaining(["DOKU_ENV", "APP_ENCRYPTION_KEY"]));
    expect(e.message).not.toContain("banana");
  });

  it("validateServerEnv passes with a valid production env", async () => {
    setEnv(BASE);
    const { validateServerEnv } = await load();
    expect(validateServerEnv().DOKU_ENV).toBe("sandbox");
  });

  describe("instrumentation register()", () => {
    const run = async () => {
      vi.resetModules();
      vi.doMock("server-only", () => ({}));
      return (await import("../instrumentation")).register();
    };

    it("throws in production when the env is invalid, naming the variable and logging it", async () => {
      setEnv({ ...BASE, DOKU_ENV: "banana" });
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(run()).rejects.toThrow(/DOKU_ENV/);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("DOKU_ENV"));
      expect(JSON.stringify(log.mock.calls)).not.toContain("banana");
    });

    it("only logs outside production, so the dev server keeps running", async () => {
      setEnv({ ...BASE, DOKU_ENV: "banana" }, "development");
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(run()).resolves.toBeUndefined();
      expect(log).toHaveBeenCalled();
    });

    it("does nothing on the edge runtime and passes silently with a valid env", async () => {
      setEnv({ ...BASE, DOKU_ENV: "banana" });
      vi.stubEnv("NEXT_RUNTIME", "edge");
      await expect(run()).resolves.toBeUndefined();
      setEnv(BASE);
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(run()).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    });
  });
});

describe("Vercel build-time env check (B1-T19)", () => {
  const GOOD = { ...SERVER, ...PROD, DOKU_ENV: "sandbox" };

  it("does nothing outside Vercel, even with an invalid or empty env (CI and local builds)", () => {
    expect(() => assertVercelBuildEnv({})).not.toThrow();
    expect(() => assertVercelBuildEnv({ ...GOOD, DOKU_ENV: "banana" })).not.toThrow();
    expect(() => assertVercelBuildEnv({ VERCEL: "0" })).not.toThrow();
  });

  it("passes on Vercel with a complete, valid env", () => {
    expect(() => assertVercelBuildEnv({ ...GOOD, VERCEL: "1" })).not.toThrow();
  });

  it("fails the build on Vercel naming every bad variable, never the values", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = errorOf(() => assertVercelBuildEnv({ ...GOOD, VERCEL: "1", DOKU_ENV: "banana", APP_ENCRYPTION_KEY: "short-secret" }));
    expect(e.names).toEqual(expect.arrayContaining(["DOKU_ENV", "APP_ENCRYPTION_KEY"]));
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("DOKU_ENV");
    expect(logged).not.toContain("banana");
    expect(logged).not.toContain("short-secret");
    log.mockRestore();
  });

  it("treats a Vercel build as production: missing production-only variables fail it", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = errorOf(() => assertVercelBuildEnv({ ...SERVER, VERCEL: "1" }));
    expect(e.names).toEqual(expect.arrayContaining([...PRODUCTION_REQUIRED]));
    log.mockRestore();
  });

  describe("next.config.ts phase gating", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    const configFor = async (vars: Record<string, string>) => {
      vi.unstubAllEnvs();
      for (const k of Object.keys(process.env)) if (k in GOOD || k.startsWith("NEXT_PUBLIC_") || k === "VERCEL") vi.stubEnv(k, "");
      for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
      vi.resetModules();
      return (await import("../next.config")).default;
    };

    it("only the production-build phase on Vercel validates", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const config = await configFor({ VERCEL: "1" }); // nothing else set: invalid
      expect(() => config("phase-production-build")).toThrow(/Invalid environment/);
      expect(() => config("phase-development-server")).not.toThrow();
      expect(() => config("phase-production-server")).not.toThrow();
      log.mockRestore();
    });

    it("without VERCEL the build phase is unaffected and the config keeps its options", async () => {
      const config = await configFor({});
      const c = config("phase-production-build");
      expect(c.cacheComponents).toBe(true);
    });
  });
});
