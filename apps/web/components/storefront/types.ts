/** Mirrors the pinned MF-T20 contract; replace with re-exports from lib once it lands. */
export type StorefrontBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  theme: Record<string, unknown>;
};

/** No ids: the get_storefront RPC deliberately returns none. */
export type StorefrontLocation = {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
};

export type ActiveStorefront = {
  status: "active";
  name: string;
  slug: string;
  branding: StorefrontBranding;
  locations: StorefrontLocation[];
};

/** `null` = unknown slug. */
export type Storefront = ActiveStorefront | { status: "unavailable" };
