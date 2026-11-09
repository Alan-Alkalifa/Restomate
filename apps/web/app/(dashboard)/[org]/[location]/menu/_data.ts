/**
 * TEMPORARY SEAM until MVM-T08 (lib/menu) merges. Delete this file and import getLocationMenu from "@/lib/menu/data".
 * Same signature as docs/contracts/menu.md. Returns fixtures so the page can be built and rendered.
 */
import type { LocationMenuData } from "@/components/menu/location/types";

export async function getLocationMenu(orgSlug: string, locationId: string): Promise<LocationMenuData> {
  void orgSlug;
  void locationId;
  return {
    currency: "IDR",
    timezone: "Asia/Jakarta",
    canManage: true,
    canToggleSoldOut: true,
    stations: [
      { id: "s1", name: "Kitchen", sortOrder: 0, isActive: true },
      { id: "s2", name: "Bar", sortOrder: 1, isActive: true },
    ],
    rows: [
      { itemId: "i1", categoryId: "c1", name: "Nasi Goreng", isPublished: true, isActive: true, basePrice: 35000, priceOverride: 38000, effectivePrice: 38000, isAvailable: true, soldOutUntil: null, kitchenStationId: "s1" },
      { itemId: "i2", categoryId: "c1", name: "Mie Goreng", isPublished: true, isActive: true, basePrice: 32000, priceOverride: null, effectivePrice: 32000, isAvailable: true, soldOutUntil: "2026-11-09T16:59:59Z", kitchenStationId: null },
      { itemId: "i3", categoryId: "c2", name: "Es Teh", isPublished: true, isActive: true, basePrice: 8000, priceOverride: null, effectivePrice: 8000, isAvailable: false, soldOutUntil: null, kitchenStationId: "s2" },
    ],
  };
}
