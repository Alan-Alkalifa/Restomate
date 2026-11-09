/**
 * TEMPORARY SEAM until MVM-T03 (lib/venue) merges. Delete this file and import getVenue from "@/lib/venue/data".
 * Same signature as docs/contracts/venue.md. Returns fixtures so the page can be built and rendered.
 */
import type { VenueData } from "@/components/venue/types";

export async function getVenue(orgSlug: string, locationId: string): Promise<VenueData> {
  void orgSlug;
  void locationId;
  return {
    canManage: true,
    tableLimit: { used: 3, max: 20 },
    areas: [
      { id: "a1", name: "Indoor", sortOrder: 0, isActive: true, tableCount: 2 },
      { id: "a2", name: "Terrace", sortOrder: 1, isActive: true, tableCount: 1 },
    ],
    tables: [
      { id: "t1", areaId: "a1", label: "T1", capacity: 4, shape: "square", status: "available", posX: null, posY: null, isActive: true },
      { id: "t2", areaId: "a1", label: "T2", capacity: 2, shape: "round", status: "occupied", posX: null, posY: null, isActive: true },
      { id: "t3", areaId: "a2", label: "P1", capacity: 6, shape: "rect", status: "needs_cleaning", posX: null, posY: null, isActive: true },
    ],
  };
}
