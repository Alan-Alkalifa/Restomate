import type { OrgContext, PermissionKey } from "./types";

export type NavItem = {
  key: string;
  label: string;
  permission: PermissionKey;
  /** Package feature flag required, if any. */
  feature?: string;
  /** `location` pages live at /[org]/[location]/[key]; `org` pages at /[org]/[key]. */
  scope: "location" | "org";
  /** Milestone in which the real page ships. */
  milestone: string;
};

/** Single source of truth: sidebar, placeholder pages and server checks all read this. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "pos", label: "POS", permission: "pos.use", scope: "location", milestone: "M2" },
  { key: "orders", label: "Orders", permission: "orders.view", scope: "location", milestone: "M2" },
  { key: "kitchen", label: "Kitchen", permission: "kitchen.view", scope: "location", milestone: "M2" },
  { key: "tables", label: "Tables", permission: "tables.view", scope: "location", milestone: "M1" },
  { key: "reservations", label: "Reservations", permission: "reservations.view", feature: "reservations", scope: "location", milestone: "M4" },
  { key: "menu", label: "Menu", permission: "menu.manage", scope: "location", milestone: "M1" },
  { key: "customers", label: "Customers", permission: "customers.view", scope: "org", milestone: "M5" },
  { key: "staff", label: "Staff", permission: "staff.manage", scope: "org", milestone: "M1" },
  { key: "payments", label: "Payments", permission: "payments.view", scope: "location", milestone: "M3" },
  { key: "reports", label: "Reports", permission: "reports.view", feature: "advanced_reports", scope: "location", milestone: "M5" },
  { key: "settings", label: "Settings", permission: "settings.manage", scope: "org", milestone: "M1" },
];

export type ResolvedNavItem = NavItem & { locked: boolean };

/** Items the user lacks permission for are dropped; items the package lacks are kept but locked. */
export function resolveNav(ctx: Pick<OrgContext, "permissions" | "package">): ResolvedNavItem[] {
  const features = ctx.package?.features ?? [];
  return NAV_ITEMS.filter((i) => ctx.permissions.includes(i.permission)).map((i) => ({
    ...i,
    locked: !!i.feature && !features.includes(i.feature),
  }));
}

/** Location-scoped pages need a location id; org-level pages never do. */
export function navHref(item: Pick<NavItem, "key" | "scope">, orgSlug: string, locationId: string | null): string {
  if (item.scope === "org") return `/${orgSlug}/${item.key}`;
  return locationId ? `/${orgSlug}/${locationId}/${item.key}` : `/${orgSlug}`;
}
