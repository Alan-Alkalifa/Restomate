/**
 * Environment validation (Zod). Client-safe: this file only ever touches NEXT_PUBLIC_* values.
 * Server-only variables live in `lib/env.server.ts` (`import 'server-only'`) and reuse the schema below.
 *
 * Validation is lazy (first property access), so `next build` does not need runtime secrets.
 * Failures list variable NAMES and a short reason only, never values.
 */
import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  /** Bare hostname used for tenant subdomains, e.g. restomate.app (no scheme, no port). */
  NEXT_PUBLIC_ROOT_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, "must be a bare hostname"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  // Analytics is optional everywhere: it must never block the app.
  NEXT_PUBLIC_POSTHOG_KEY: nonEmpty.optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
});
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

export const serverEnvSchema = serverBase.extend(publicEnvSchema.shape);
export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
  options: { production?: boolean; requireInProduction?: readonly string[] } = {},
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
  // Log mode prints rendered email bodies (invite tokens included) and sends nothing: never acceptable in production.
  if (options.production && cleaned.EMAIL_DELIVERY !== undefined && cleaned.EMAIL_DELIVERY !== "resend") {
    problems.set("EMAIL_DELIVERY", 'must be "resend" in production');
  }
  // Real delivery needs credentials and a sender in every environment (EMAIL_FROM has a dev default, so check it is explicit).
  if (cleaned.EMAIL_DELIVERY === "resend") {
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
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

export const publicEnv: PublicEnv = lazy(loadPublicEnv);
