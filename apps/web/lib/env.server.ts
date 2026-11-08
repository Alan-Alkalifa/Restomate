import "server-only";
import { parseEnv, PRODUCTION_REQUIRED, serverEnvSchema, type ServerEnv } from "./env";

function loadServerEnv(): ServerEnv {
  return parseEnv(
    serverEnvSchema,
    process.env,
    { production: process.env.NODE_ENV === "production", requireInProduction: PRODUCTION_REQUIRED },
  );
}

let cached: ServerEnv | undefined;

/** Validated server environment (includes the public values). Server-only; parsed on first use. */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get: (_t, key) => Reflect.get((cached ??= loadServerEnv()), key),
  has: (_t, key) => Reflect.has((cached ??= loadServerEnv()), key),
});
