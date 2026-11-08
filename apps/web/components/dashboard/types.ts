/** Mirrors the MF-T07 DAL contract; replace with re-exports from lib/auth once it lands. */
export type PermissionKey = string;

export type OrgContext = {
  org: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended" | "past_due" | "read_only";
    currency: string;
    timezone: string;
  };
  membership: { roleKey: string; roleName: string; allLocations: boolean };
  permissions: PermissionKey[];
  locations: { id: string; name: string }[];
  package: {
    code: string;
    name: string;
    features: string[];
    limits: Record<string, number | null>;
  } | null;
};

/** No PII in OrgContext; the user menu reads this separately. */
export type CurrentUser = { id: string; email: string } | null;
