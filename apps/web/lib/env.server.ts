import "server-only";
import {
  ENV_SLICES,
  envSliceSchemas,
  parseEnv,
  PRODUCTION_REQUIRED,
  validateFullServerEnv,
  sliceOfEnvKey,
  type EnvSlice,
  type EnvSliceName,
  type ServerEnv,
} from "./env";

const production = () => process.env.NODE_ENV === "production";

/**
 * Validate the WHOLE server env. Called once at boot by `instrumentation.ts`; throws EnvError naming every bad
 * variable (names and reasons, never values).
 */
export function validateServerEnv(): ServerEnv {
  return validateFullServerEnv(process.env, production());
}

const slices = new Map<EnvSliceName, unknown>();

/** One slice, validated on first use and cached. A failure is not cached, so a fixed env recovers on the next call. */
export function serverEnvSlice<N extends EnvSliceName>(name: N): EnvSlice<N> {
  if (!slices.has(name)) {
    const members = ENV_SLICES[name] as readonly string[];
    slices.set(
      name,
      parseEnv(envSliceSchemas[name], process.env, {
        production: production(),
        requireInProduction: PRODUCTION_REQUIRED.filter((k) => members.includes(k)),
        emailRules: name === "email",
      }),
    );
  }
  return slices.get(name) as EnvSlice<N>;
}

/**
 * Validated server environment (includes the public values). Server-only. Reading one variable validates ONLY the
 * slice it belongs to (see ENV_SLICES in env.ts), so an unrelated bad variable (say DOKU_ENV) cannot break, for
 * example, the email path. The whole env is checked once at boot by `validateServerEnv()`.
 */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get: (_t, key) => {
    const slice = typeof key === "string" ? sliceOfEnvKey(key) : undefined;
    return slice ? Reflect.get(serverEnvSlice(slice) as object, key) : undefined;
  },
  has: (_t, key) => typeof key === "string" && sliceOfEnvKey(key) !== undefined,
});
