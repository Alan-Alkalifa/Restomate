import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Enables forbidden() (403) from next/navigation for the auth DAL (experimental in Next 16).
  experimental: { authInterrupts: true },
};

export default nextConfig;
