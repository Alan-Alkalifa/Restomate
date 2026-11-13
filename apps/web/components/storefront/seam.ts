import "server-only";

import { connection } from "next/server";
import type { StorefrontLocation } from "@/lib/storefront/get-storefront";
import { localParts } from "./hours";
import type { HoursRow, LocationInfo, PublicMenu } from "./menu-model";

/*
 * TEMPORARY SEAM until DAVIN's MCS-T02 (lib/storefront) merges. Delete this file and import the real functions:
 *   getStorefront(slug)            -> locations gain an `id` (storefront.md "Changes" 5), so `withIds` goes away;
 *   getPublicMenu(slug, locationId)  wraps the existing SQL get_public_menu(org_slug, location_id);
 *   getLocationInfo(slug, locationId) wraps get_public_location_info (new).
 * Shapes follow docs/contracts/storefront.md and the SQL in 20261109100000_menu_schema.sql. It serves FIXTURE data (no
 * database), the same for every tenant, so the pages can be built and driven. It proves nothing about the real functions.
 */
export type LocationWithId = StorefrontLocation & { id: string };

/** uuid-shaped, deterministic per position: only a stand-in for the real location ids. */
export const seamLocationId = (index: number): string => `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
export const withIds = (locations: readonly StorefrontLocation[]): LocationWithId[] => locations.map((l, i) => ({ ...l, id: seamLocationId(i) }));
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIXTURE_MENU: PublicMenu = {
  currency: "IDR",
  categories: [
    {
      id: "00000000-0000-4000-8000-00000000c001", name: "Makanan Utama", description: "Dimasak segar setiap hari",
      items: [
        { id: "00000000-0000-4000-8000-00000000a001", name: "Nasi Goreng", description: "Nasi goreng dengan telur dan acar.", imageUrl: null, dietaryTags: [], price: 35000, soldOut: false,
          variants: [{ id: "00000000-0000-4000-8000-0000000000b1", name: "Biasa", priceDelta: 0 }, { id: "00000000-0000-4000-8000-0000000000b2", name: "Besar", priceDelta: 8000 }],
          modifierGroups: [
            { id: "00000000-0000-4000-8000-0000000000d1", name: "Tingkat pedas", minSelect: 1, maxSelect: 1, modifiers: [{ id: "00000000-0000-4000-8000-0000000000e1", name: "Tidak pedas", priceDelta: 0 }, { id: "00000000-0000-4000-8000-0000000000e2", name: "Sedang", priceDelta: 0 }, { id: "00000000-0000-4000-8000-0000000000e3", name: "Pedas", priceDelta: 0 }] },
            { id: "00000000-0000-4000-8000-0000000000d2", name: "Tambahan", minSelect: 0, maxSelect: 2, modifiers: [{ id: "00000000-0000-4000-8000-0000000000e4", name: "Telur mata sapi", priceDelta: 5000 }, { id: "00000000-0000-4000-8000-0000000000e5", name: "Kerupuk", priceDelta: 3000 }, { id: "00000000-0000-4000-8000-0000000000e6", name: "Ayam suwir", priceDelta: 12000 }] },
          ] },
        { id: "00000000-0000-4000-8000-00000000a002", name: "Sate Ayam", description: "10 tusuk dengan bumbu kacang.", imageUrl: null, dietaryTags: [], price: 32000, soldOut: false, variants: [], modifierGroups: [] },
        { id: "00000000-0000-4000-8000-00000000a003", name: "Soto Betawi", description: "Kuah santan, daging sapi, emping.", imageUrl: null, dietaryTags: [], price: 38000, soldOut: true, variants: [], modifierGroups: [] },
      ],
    },
    {
      id: "00000000-0000-4000-8000-00000000c002", name: "Minuman", description: null,
      items: [
        { id: "00000000-0000-4000-8000-00000000a004", name: "Es Teh Manis", description: null, imageUrl: null, dietaryTags: ["vegan"], price: 8000, soldOut: false, variants: [], modifierGroups: [
          { id: "00000000-0000-4000-8000-0000000000d3", name: "Gula", minSelect: 0, maxSelect: 1, modifiers: [{ id: "00000000-0000-4000-8000-0000000000e7", name: "Kurang manis", priceDelta: 0 }] }] },
        { id: "00000000-0000-4000-8000-00000000a005", name: "Kopi Susu", description: "Espresso, susu, gula aren.", imageUrl: null, dietaryTags: [], price: 22000, soldOut: false,
          variants: [{ id: "00000000-0000-4000-8000-0000000000b3", name: "Panas", priceDelta: 0 }, { id: "00000000-0000-4000-8000-0000000000b4", name: "Dingin", priceDelta: 2000 }], modifierGroups: [] },
      ],
    },
  ],
};

/** Mon-Fri 10:00-22:00, Sat 10:00-24:00, Sun 12:00-20:00. */
const FIXTURE_HOURS: HoursRow[] = [
  ...[1, 2, 3, 4, 5].map((day) => ({ day, opens: 600, closes: 1320 })),
  { day: 6, opens: 600, closes: 1440 },
  { day: 0, opens: 720, closes: 1200 },
];

export async function getPublicMenu(slug: string, locationId: string): Promise<PublicMenu | null> {
  void slug;
  return UUID.test(locationId) ? FIXTURE_MENU : null;
}

/** Not cached in the real one (open now depends on the clock), hence `connection()`. */
export async function getLocationInfo(slug: string, locationId: string, locations: readonly LocationWithId[]): Promise<LocationInfo | null> {
  void slug;
  await connection();
  const loc = locations.find((l) => l.id === locationId);
  if (!loc) return null;
  const { day, minutes } = localParts(new Date(), loc.timezone);
  return {
    name: loc.name, currency: "IDR", timezone: loc.timezone, address: loc.address, city: loc.city, phone: loc.phone,
    taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true,
    hours: FIXTURE_HOURS,
    openNow: FIXTURE_HOURS.some((h) => h.day === day && h.opens <= minutes && minutes < h.closes),
    ordering: { qr: true, online: false, accepting: true },
    minOrderAmount: 0,
  };
}
