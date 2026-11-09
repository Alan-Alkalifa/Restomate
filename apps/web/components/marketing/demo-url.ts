/**
 * Demo Restaurant storefront. Built from NEXT_PUBLIC_ROOT_DOMAIN (inlined at build time),
 * never hard-coded: a subdomain in production, path-based on localhost.
 */
export function getDemoUrl(rootDomain: string | undefined = process.env.NEXT_PUBLIC_ROOT_DOMAIN): string {
  const root = rootDomain?.trim();
  return root && !root.startsWith("localhost") ? `https://demo.${root}` : "/s/demo";
}
