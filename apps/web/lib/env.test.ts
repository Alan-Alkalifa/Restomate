import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, PRODUCTION_REQUIRED, publicEnvSchema, serverEnvSchema } from "./env";

const PUBLIC = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
};
const SERVER = { ...PUBLIC, SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value" };
const PROD = {
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
    const env = parseEnv(serverEnvSchema, { ...SERVER, ...PROD, EMAIL_DELIVERY: "resend" }, { production: true, requireInProduction: PRODUCTION_REQUIRED });
    expect(env.EMAIL_DELIVERY).toBe("resend");
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
