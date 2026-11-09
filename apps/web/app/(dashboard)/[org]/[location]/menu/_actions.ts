"use server";

/**
 * TEMPORARY SEAM until MVM-T08 (lib/menu) merges. Delete this file and import the actions from "@/lib/menu/actions"
 * ('use server' files cannot re-export). Names and signatures are from docs/contracts/menu.md.
 */
import type { ActionResult } from "@/lib/auth/schemas";

type LocationMenuAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
const stub: LocationMenuAction = async () => ({ ok: false, formError: "Not available yet." });

export const setLocationOverride: LocationMenuAction = stub;
export const toggleSoldOut: LocationMenuAction = stub;
export const createStation: LocationMenuAction = stub;
export const renameStation: LocationMenuAction = stub;
export const setStationActive: LocationMenuAction = stub;
