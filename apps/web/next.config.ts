import type { NextConfig } from "next";
import { assertVercelBuildEnv } from "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Enables forbidden() (403) from next/navigation for the auth DAL (experimental in Next 16).
  experimental: { authInterrupts: true },
};

// Exported as a function so the env check runs only for `next build` (not dev, not start), and only when
// VERCEL=1 (assertVercelBuildEnv is a no-op elsewhere): a bad staging/production deploy fails the build visibly.
export default function config(phase: string): NextConfig {
  if (phase === "phase-production-build") assertVercelBuildEnv();
  return nextConfig;
}
