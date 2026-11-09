import type { BoundMenuAction } from "../types";

// SEAM: replaced with `import type { ... } from "@/lib/menu/data"` when MVM-T08 merges (names from docs/contracts/menu.md).
export type KitchenStation = { id: string; name: string; sortOrder: number; isActive: boolean };
export type LocationMenuRow = {
  itemId: string; categoryId: string; name: string; isPublished: boolean; isActive: boolean;
  basePrice: number; priceOverride: number | null; effectivePrice: number;
  isAvailable: boolean; soldOutUntil: string | null; kitchenStationId: string | null;
};
export type LocationMenuData = {
  currency: string; timezone: string; rows: LocationMenuRow[]; stations: KitchenStation[];
  canManage: boolean; canToggleSoldOut: boolean;
};

/** Actions with orgSlug AND locationId already bound on the server. */
export type LocationMenuActions = {
  setLocationOverride: BoundMenuAction;
  toggleSoldOut: BoundMenuAction;
  createStation: BoundMenuAction;
  renameStation: BoundMenuAction;
  setStationActive: BoundMenuAction;
};
