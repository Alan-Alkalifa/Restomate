export const TENANT_LIMIT_KEYS = ["max_locations", "max_staff", "max_tables", "max_orders_per_month"] as const;
export type TenantLimitKey = (typeof TENANT_LIMIT_KEYS)[number];

export type TenantSubscription = {
  id: string;
  packageCode: string;
  packageName: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  billingPeriod: "monthly" | "yearly";
  trialEndsAt: string | null; // ISO
  currentPeriodEnd: string | null; // ISO
  canceledAt: string | null; // ISO
  createdAt: string; // ISO
};

export type TenantAuditEntry = {
  id: number;
  action: string;
  /** profiles.full_name; null = system or unknown (show "System"). Never an email. */
  actorName: string | null;
  createdAt: string; // ISO
  metadata: Record<string, unknown>;
};

export type TenantDetail = {
  org: { id: string; name: string; slug: string; status: "active" | "suspended" | "past_due" | "read_only"; createdAt: string };
  locations: { id: string; name: string; timezone: string; currency: string; isActive: boolean }[];
  subscription: TenantSubscription | null;
  subscriptionHistory: TenantSubscription[];
  /** `limit` null = unlimited; 0 = no live subscription (the plan-limit triggers refuse everything). max_orders_per_month.used is 0 until M3. */
  usage: Record<TenantLimitKey, { used: number; limit: number | null }>;
  /** Active owners only. Platform-admin payload only. */
  owners: { userId: string; name: string | null; email: string }[];
  auditTrail: TenantAuditEntry[];
};
