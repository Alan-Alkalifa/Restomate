import type { BoundMenuAction } from "../types";

// Data shapes come from the real lib/menu/data (type-only import: erased at build, nothing server-only reaches the client).
import type { getLocationMenu } from "@/lib/menu/data";
export type { KitchenStation, LocationMenuRow } from "@/lib/menu/data";

export type LocationMenuData = Awaited<ReturnType<typeof getLocationMenu>>;

/** Actions with orgSlug AND locationId already bound on the server. */
export type LocationMenuActions = {
  setLocationOverride: BoundMenuAction;
  toggleSoldOut: BoundMenuAction;
  createStation: BoundMenuAction;
  renameStation: BoundMenuAction;
  setStationActive: BoundMenuAction;
};
