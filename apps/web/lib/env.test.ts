import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, PRODUCTION_REQUIRED, publicEnvSchema, serverEnvSchema } from "./env";

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
