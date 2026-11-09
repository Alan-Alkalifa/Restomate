import { forbidden } from "next/navigation";
import type { OrgContext } from "@/lib/auth/dal";
import { publicEnv } from "@/lib/env";
import { locationIdSchema } from "./schemas";

export const venueTag = (locationId: string) => `venue:${locationId}`;

/** The location must be a uuid the caller can access (ctx.locations is already filtered by has_location_access). */
export function assertLocation(ctx: OrgContext, locationId: string): void {
  if (!locationIdSchema.safeParse(locationId).success || !ctx.locations.some((l) => l.id === locationId)) forbidden();
}

/** `{slug}.{ROOT_DOMAIN}` with the scheme and port of the app URL (so local dev gives http://demo.localhost:3000). */
export function storefrontOrigin(slug: string): string {
  const app = new URL(publicEnv.NEXT_PUBLIC_APP_URL);
  return `${app.protocol}//${slug}.${publicEnv.NEXT_PUBLIC_ROOT_DOMAIN}${app.port ? `:${app.port}` : ""}`;
}
