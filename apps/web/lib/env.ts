/**
 * Environment validation (Zod). Client-safe: this file only ever touches NEXT_PUBLIC_* values.
 * Server-only variables live in `lib/env.server.ts` (`import 'server-only'`) and reuse the schema below.
 *
 * Validation is lazy (first property access), so `next build` does not need runtime secrets. In production
 * `instrumentation.ts` validates the WHOLE server env once at boot (`validateServerEnv`), so a misconfigured
 * deployment fails fast and loudly instead of inside an `after()` callback.
 *
 * Server variables are grouped into SLICES (ENV_SLICES). A module reading `serverEnv.X` validates only the slice
 * X belongs to, so e.g. the email path never fails because of DOKU_* or APP_ENCRYPTION_KEY.
 * Failures list variable NAMES and a short reason only, never values.
 */
import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

const publicBase = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  /** Bare hostname used for tenant subdomains, e.g. restomate.app (no scheme, no port). */
  NEXT_PUBLIC_ROOT_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, "must be a bare hostname"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Supabase's current name for the client key. Preferred over the legacy ANON_KEY. */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty.optional(),
  /** Legacy name, still accepted as a fallback. */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty.optional(),
  // Analytics is optional everywhere: it must never block the app.
  NEXT_PUBLIC_POSTHOG_KEY: nonEmpty.optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
});

const KEY_HINT = "set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)";
type KeyFields = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string };
const noKey = (v: KeyFields) => !v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !v.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Requires at least one client key (named in the error, even when other variables are also invalid) and
 * exposes the winner (PUBLISHABLE, else ANON) as `supabasePublishableKey`.
 */
function withClientKey<S extends z.ZodType<KeyFields>>(schema: S) {
  return schema
    .refine((v) => !noKey(v), { path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], error: KEY_HINT, when: () => true })
    .refine((v) => !noKey(v), { path: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"], error: KEY_HINT, when: () => true })
    .transform((v) => ({
      ...v,
      supabasePublishableKey: (v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || v.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string,
    }));
}

export const publicEnvSchema = withClientKey(publicBase);
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** 32 bytes as 64 hex chars or base64. */
const encryptionKey = nonEmpty.refine(
  (v) => (/^[0-9a-fA-F]{64}$/.test(v) ? true : Buffer.from(v, "base64").length === 32),
  "must be 32 bytes (64 hex chars or base64)",
);

const serverBase = z.object({
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  EMAIL_FROM: nonEmpty.default("Restomate <no-reply@mail.restomate.app>"),
  EMAIL_DELIVERY: z.enum(["resend", "log"]).default("log"),
  DOKU_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // Optional in development, required in production (checked below).
  ARCJET_KEY: nonEmpty.optional(),
  RESEND_API_KEY: nonEmpty.optional(),
  DOKU_CLIENT_ID: nonEmpty.optional(),
  DOKU_SECRET_KEY: nonEmpty.optional(),
  APP_ENCRYPTION_KEY: encryptionKey.optional(),
});

export const PRODUCTION_REQUIRED = [
  "EMAIL_DELIVERY",
  "ARCJET_KEY",
  "RESEND_API_KEY",
  "DOKU_CLIENT_ID",
  "DOKU_SECRET_KEY",
  "APP_ENCRYPTION_KEY",
] as const;

export const serverEnvSchema = withClientKey(serverBase.extend(publicBase.shape));
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Which variables are validated together. `public` (NEXT_PUBLIC_*, plus the derived `supabasePublishableKey`) is
 * needed by every request path. The others are independent: a bad DOKU_ENV must not break email or Supabase admin.
 */
export const ENV_SLICES = {
  public: [...Object.keys(publicBase.shape), "supabasePublishableKey"],
  email: ["EMAIL_FROM", "EMAIL_DELIVERY", "RESEND_API_KEY"],
  supabaseAdmin: ["SUPABASE_SERVICE_ROLE_KEY"],
  arcjet: ["ARCJET_KEY"],
  doku: ["DOKU_ENV", "DOKU_CLIENT_ID", "DOKU_SECRET_KEY"],
  encryption: ["APP_ENCRYPTION_KEY"],
} as const satisfies Record<string, readonly string[]>;
export type EnvSliceName = keyof typeof ENV_SLICES;

export const envSliceSchemas = {
  public: publicEnvSchema,
  email: serverBase.pick({ EMAIL_FROM: true, EMAIL_DELIVERY: true, RESEND_API_KEY: true }),
  supabaseAdmin: serverBase.pick({ SUPABASE_SERVICE_ROLE_KEY: true }),
  arcjet: serverBase.pick({ ARCJET_KEY: true }),
  doku: serverBase.pick({ DOKU_ENV: true, DOKU_CLIENT_ID: true, DOKU_SECRET_KEY: true }),
  encryption: serverBase.pick({ APP_ENCRYPTION_KEY: true }),
} as const;

export type EnvSlice<N extends EnvSliceName> = z.infer<(typeof envSliceSchemas)[N]>;

/** Env slice a server variable belongs to (undefined for names that are not env variables). */
export function sliceOfEnvKey(key: string): EnvSliceName | undefined {
  return (Object.keys(ENV_SLICES) as EnvSliceName[]).find((n) => (ENV_SLICES[n] as readonly string[]).includes(key));
}

export class EnvError extends Error {
  constructor(readonly names: string[], detail: string) {
    super(`Invalid environment: ${detail}`);
    this.name = "EnvError";
  }
}

/** Parse `source` with `schema`; `production` additionally requires PRODUCTION_REQUIRED (server schema only). */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
  options: { production?: boolean; requireInProduction?: readonly string[]; emailRules?: boolean } = {},
): z.infer<S> {
  // Treat empty strings (e.g. `FOO=` in a dotenv file) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = schema.safeParse(cleaned);
  const problems = new Map<string, string>();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? "(root)");
      const missing = issue.code === "invalid_type" && !(name in cleaned);
      problems.set(name, missing ? "missing" : issue.message);
    }
  }
  if (options.production) {
    for (const name of options.requireInProduction ?? []) {
      if (!(name in cleaned)) problems.set(name, "required in production");
    }
  }
  // The two email rules below apply to the full server env and the email slice; other slices skip them.
  const emailRules = options.emailRules ?? true;
  // Log mode prints rendered email bodies (invite tokens included) and sends nothing: never acceptable in production.
  if (emailRules && options.production && cleaned.EMAIL_DELIVERY !== undefined && cleaned.EMAIL_DELIVERY !== "resend") {
    problems.set("EMAIL_DELIVERY", 'must be "resend" in production');
  }
  // Real delivery needs credentials and a sender in every environment (EMAIL_FROM has a dev default, so check it is explicit).
  if (emailRules && cleaned.EMAIL_DELIVERY === "resend") {
    for (const name of ["RESEND_API_KEY", "EMAIL_FROM"]) {
      if (!(name in cleaned)) problems.set(name, 'required when EMAIL_DELIVERY is "resend"');
    }
  }
  if (problems.size > 0) {
    const names = [...problems.keys()];
    throw new EnvError(names, names.map((n) => `${n} (${problems.get(n)})`).join(", "));
  }
  return (result as { data: z.infer<S> }).data;
}

/**
 * Validate the WHOLE server env against `source`. `production` defaults to NODE_ENV === "production".
 * Used at boot (instrumentation.ts, via env.server.ts) and by the Vercel build check below. Throws EnvError naming
 * every bad variable (names and reasons, never values).
 */
export function validateFullServerEnv(
  source: Record<string, string | undefined> = process.env,
  production: boolean = process.env.NODE_ENV === "production",
): ServerEnv {
  return parseEnv(serverEnvSchema, source, { production, requireInProduction: PRODUCTION_REQUIRED });
}

/**
 * Build-time guard for Vercel (B1-T19): when VERCEL=1, a missing or invalid server variable fails the BUILD with a
 * message that names the variables (never values), instead of a deploy that boots into errors. Does nothing
 * anywhere else, so CI and local builds need no runtime secrets. Called from next.config.ts (production-build phase).
 */
export function assertVercelBuildEnv(source: Record<string, string | undefined> = process.env): void {
  if (source.VERCEL !== "1") return;
  try {
    validateFullServerEnv(source, true); // a Vercel build is always a production build
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`[env] Vercel build blocked. ${e.message}. Set these in the Vercel project (Settings -> Environment Variables) for this environment, then redeploy.`);
    }
    throw e;
  }
}

function lazy<T extends object>(load: () => T): T {
  let cached: T | undefined;
  const get = () => (cached ??= load());
  return new Proxy({} as T, {
    get: (_t, key) => Reflect.get(get(), key),
    has: (_t, key) => Reflect.has(get(), key),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Reflect.getOwnPropertyDescriptor(get(), key);
      return d && { ...d, configurable: true };
    },
  });
}

/**
 * Browser-safe. NEXT_PUBLIC_* must be referenced as literal `process.env.NAME` so Next can inline them.
 */
export function loadPublicEnv(): PublicEnv {
  return parseEnv(publicEnvSchema, {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

export const publicEnv: PublicEnv = lazy(loadPublicEnv);
