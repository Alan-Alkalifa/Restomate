import { forbidden } from "next/navigation";
import type { OrgContext } from "@/lib/auth/dal";
import { z } from "zod";

export const menuTag = (orgId: string) => `menu:${orgId}`;
export const menuLocationTag = (orgId: string, locationId: string) => `menu:${orgId}:${locationId}`;

/** The location must be a uuid the caller can access (ctx.locations is already filtered by has_location_access). */
export function assertLocation(ctx: OrgContext, locationId: string): void {
  if (!z.string().uuid().safeParse(locationId).success || !ctx.locations.some((l) => l.id === locationId)) forbidden();
}

export const canToggleSoldOut = (ctx: OrgContext) => ctx.permissions.includes("menu.manage") || ctx.permissions.includes("orders.create");
