/**
 * Permission catalog. MUST match `public.permissions` (see supabase/migrations/…_foundation_core.sql);
 * supabase/tests/database/007_get_org_package.test.sql fails when the two drift apart.
 */
export const PERMISSION_KEYS = [
  "menu.manage",
  "orders.view",
  "orders.create",
  "orders.void",
  "pos.use",
  "pos.discount",
  "kitchen.view",
  "kitchen.update",
  "tables.view",
  "tables.manage",
  "reservations.view",
  "reservations.manage",
  "payments.view",
  "payments.take",
  "payments.refund",
  "bills.print",
  "customers.view",
  "customers.manage",
  "reports.view",
  "staff.manage",
  "locations.manage",
  "settings.manage",
  "settings.branding",
  "billing.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && KEY_SET.has(value);
}
