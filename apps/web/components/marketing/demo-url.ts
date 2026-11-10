/**
 * Demo Restaurant storefront. Built from NEXT_PUBLIC_ROOT_DOMAIN (inlined at build time),
 * never hard-coded: a subdomain on a real domain, path-based (/s/demo) on localhost and on *.vercel.app, where
 * there is no wildcard DNS so demo.{root} would not resolve.
 */
export function getDemoUrl(rootDomain: string | undefined = process.env.NEXT_PUBLIC_ROOT_DOMAIN): string {
  const root = rootDomain?.trim();
  if (!root) return "/s/demo";
  const host = root.toLowerCase().replace(/:\d+$/, "");
  if (host === "localhost" || host.endsWith(".vercel.app")) return "/s/demo";
  return `https://demo.${root}`;
}
