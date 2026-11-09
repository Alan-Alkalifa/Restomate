import type { ActionResult } from "@/lib/auth/schemas";

// SEAM: replaced with `import type { Area, VenueTable } from "@/lib/venue/data"` when MVM-T03 merges.
export type Area = { id: string; name: string; sortOrder: number; isActive: boolean; tableCount: number };
export type TableShape = "square" | "round" | "rect";
export type TableStatus = "available" | "reserved" | "occupied" | "needs_cleaning";
export type VenueTable = {
  id: string; areaId: string; label: string; capacity: number; shape: TableShape; status: TableStatus;
  posX: number | null; posY: number | null; isActive: boolean;
};
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
