export { assertLocation } from "@/lib/venue/shared";

/** Cache tag for a tenant's public storefront data (branding, menu). Slug only: no ids, no personal data. */
export const storefrontTag = (slug: string) => `storefront:${slug}`;

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
