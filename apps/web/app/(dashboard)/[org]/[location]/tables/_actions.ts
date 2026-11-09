"use server";

/**
 * TEMPORARY SEAM until MVM-T03 (lib/venue) merges. Delete this file and import the actions from
 * "@/lib/venue/actions" ('use server' files cannot re-export). Same signatures as docs/contracts/venue.md.
 */
import type { ActionResult } from "@/lib/auth/schemas";

type VenueAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
const stub: VenueAction = async () => ({ ok: false, formError: "Not available yet." });

export const createArea: VenueAction = stub;
export const renameArea: VenueAction = stub;
export const setAreaActive: VenueAction = stub;
export const reorderAreas: VenueAction = stub;
export const createTable: VenueAction = stub;
export const updateTable: VenueAction = stub;
export const setTableActive: VenueAction = stub;
export const rotateTableQr: VenueAction = stub;
