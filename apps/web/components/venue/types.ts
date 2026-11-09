import type { ActionResult } from "@/lib/auth/schemas";

import type { Area, VenueTable } from "@/lib/venue/data";

export type { Area, VenueTable };
export type TableShape = VenueTable["shape"];
export type TableStatus = VenueTable["status"];
export type VenueData = {
  areas: Area[];
  tables: VenueTable[];
  canManage: boolean;
  tableLimit: { used: number; max: number | null };
};

/** A form action with orgSlug and locationId already bound on the server (docs/contracts/venue.md). */
export type BoundVenueAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export type VenueActions = {
  createArea: BoundVenueAction;
  renameArea: BoundVenueAction;
  setAreaActive: BoundVenueAction;
  reorderAreas: BoundVenueAction;
  createTable: BoundVenueAction;
  updateTable: BoundVenueAction;
  setTableActive: BoundVenueAction;
  rotateTableQr: BoundVenueAction;
};

export type { ActionResult };
