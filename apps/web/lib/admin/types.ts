export type TenantStatus = "active" | "suspended" | "past_due" | "read_only";

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | null;
  trialEndsAt: string | null; // ISO
  locationsCount: number;
  membersCount: number;
  ownerEmail: string | null;
  createdAt: string; // ISO
};

/** page is 1-based; pageSize defaults to 25, max 100. */
export type ListTenantsInput = {
  q?: string;
  status?: TenantStatus;
  packageCode?: string;
  page?: number;
  pageSize?: number;
};

export type ListTenantsResult = { rows: TenantRow[]; total: number };
