import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { moveArea } from "./areas";
import { codeOf, venueErrorMessage } from "./errors";
import type { Area, BoundVenueAction, VenueActions, VenueData } from "./types";
import { usageText, VenueManager } from "./VenueManager";

const noop: BoundVenueAction = async () => ({ ok: true });
const actions: VenueActions = {
  createArea: noop, renameArea: noop, setAreaActive: noop, reorderAreas: noop,
  createTable: noop, updateTable: noop, setTableActive: noop, rotateTableQr: noop,
};
const areas: Area[] = [
  { id: "a1", name: "Indoor", sortOrder: 0, isActive: true, tableCount: 1 },
  { id: "a2", name: "Terrace", sortOrder: 1, isActive: true, tableCount: 0 },
  { id: "a3", name: "Old room", sortOrder: 2, isActive: false, tableCount: 0 },
];
const data = (over: Partial<VenueData> = {}): VenueData => ({
  areas,
  tables: [{ id: "t1", areaId: "a1", label: "T1", capacity: 4, shape: "round", status: "needs_cleaning", posX: null, posY: null, isActive: true }],
  canManage: true,
  tableLimit: { used: 12, max: 20 },
  ...over,
});
const html = (d: VenueData) => renderToStaticMarkup(<VenueManager data={d} actions={actions} upgradeHref="/demo/settings" />);

describe("VenueManager (SSR)", () => {
  it("shows plan usage, areas, tables grouped by area and a status label", () => {
    const out = html(data());
    expect(out).toContain("12 / 20 tables");
    expect(out).toContain("Indoor");
    expect(out).toContain("Tables in Indoor");
    expect(out).toContain("Needs cleaning");
    expect(out).toContain("Round");
    expect(out).toContain("Add area");
    expect(out).toContain("Add table");
  });
  it("is read-only without tables.manage: no action buttons, no hidden ids", () => {
    const out = html(data({ canManage: false }));
    expect(out).not.toContain("Add area");
    expect(out).not.toContain("Add table");
    expect(out).not.toContain("Rotate QR");
    expect(out).not.toContain('name="tableId"');
    expect(out).toContain("Ask a manager to make changes");
  });
  it("disables Add table and offers an upgrade at the plan limit", () => {
    const out = html(data({ tableLimit: { used: 20, max: 20 } }));
    expect(out).toContain("reached your plan");
    expect(out).toContain('href="/demo/settings"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Add table<\/button>/);
  });
  it("explains the empty states", () => {
    expect(html(data({ areas: [], tables: [] }))).toContain("No areas yet.");
    expect(html(data({ tables: [] }))).toContain("No tables yet.");
  });
  it("offers only active areas in the table picker and disables Rotate QR on inactive tables", () => {
    const out = html(data({
      tables: [
        { id: "t1", areaId: "a1", label: "T1", capacity: 4, shape: "round", status: "available", posX: null, posY: null, isActive: true },
        { id: "t2", areaId: "a1", label: "T2", capacity: 2, shape: "square", status: "available", posX: null, posY: null, isActive: false },
      ],
    }));
    expect(out).toContain('aria-label="Rotate QR code for table T1"');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Rotate QR code for table T2"|<button[^>]*aria-label="Rotate QR code for table T2"[^>]*disabled=""/);
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Rotate QR code for table T1"|<button[^>]*aria-label="Rotate QR code for table T1"[^>]*disabled=""/);
  });
  it("never puts an organization id in a form", () => {
    expect(html(data())).not.toMatch(/organization|orgId|org_id/i);
  });
  it("usageText handles an unlimited plan", () => {
    expect(usageText({ used: 3, max: null })).toBe("3 tables (no limit)");
  });
});

describe("moveArea", () => {
  it("returns the full new order after a swap", () => {
    expect(moveArea(areas, "a2", "up")).toEqual(["a2", "a1", "a3"]);
    expect(moveArea(areas, "a1", "down")).toEqual(["a2", "a1", "a3"]);
  });
  it("returns null at the ends and for unknown ids", () => {
    expect(moveArea(areas, "a1", "up")).toBeNull();
    expect(moveArea(areas, "a3", "down")).toBeNull();
    expect(moveArea(areas, "nope", "up")).toBeNull();
  });
});

describe("venueErrorMessage", () => {
  it("maps the contract codes to friendly copy", () => {
    // @ts-expect-error DUPLICATE_NAME / AREA_NOT_EMPTY join ActionErrorCode when MVM-T03 lands
    const dup = venueErrorMessage({ ok: false, code: "DUPLICATE_NAME", formError: "An area named Indoor already exists." });
    expect(dup).toBe("An area named Indoor already exists.");
    // @ts-expect-error see above
    expect(venueErrorMessage({ ok: false, code: "AREA_NOT_EMPTY" })).toContain("active tables");
    expect(venueErrorMessage({ ok: false, code: "PLAN_LIMIT" })).toContain("table limit");
    expect(venueErrorMessage({ ok: false, code: "FORBIDDEN" })).toContain("permission");
    expect(venueErrorMessage({ ok: false, formError: "Boom" })).toBe("Boom");
    expect(venueErrorMessage({ ok: true })).toBeUndefined();
    expect(codeOf(null)).toBeUndefined();
  });
});
