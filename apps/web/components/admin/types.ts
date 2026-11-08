/** Mirrors the pinned MF-T22 contract; replace with lib re-exports once it lands. */
export type OrgStatus = "active" | "suspended" | "past_due" | "read_only";
export const ORG_STATUSES: readonly OrgStatus[] = ["active", "suspended", "past_due", "read_only"];

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  locationsCount: number;
  membersCount: number;
  ownerEmail: string | null;
  createdAt: string;
};

export type ListTenantsInput = {
  q?: string;
  status?: OrgStatus;
  packageCode?: string;
  page?: number;
  pageSize?: number;
};

export type ListTenantsResult = { rows: TenantRow[]; total: number };
