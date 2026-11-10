import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { FloorPlan, type FloorData } from "./FloorPlan";

const save = async () => ({ ok: true as const });
const data = (o: Partial<FloorData> = {}): FloorData => ({
  canManage: true,
  areas: [
    { id: "a1", name: "Indoor", sortOrder: 0, isActive: true, tableCount: 2 },
    { id: "a2", name: "Old", sortOrder: 1, isActive: false, tableCount: 0 },
  ],
  tables: [
    { id: "t1", areaId: "a1", label: "T1", capacity: 4, shape: "square", status: "available", posX: 100, posY: 200, isActive: true },
    { id: "t2", areaId: "a1", label: "T2", capacity: 2, shape: "round", status: "available", posX: null, posY: null, isActive: true },
    { id: "t3", areaId: "a1", label: "Gone", capacity: 2, shape: "round", status: "available", posX: 5, posY: 5, isActive: false },
  ],
  ...o,
});

describe("FloorPlan", () => {
  it("shows placed tables on the plan and unplaced ones in the tray; no inactive tables or areas", () => {
    const html = renderToStaticMarkup(<FloorPlan data={data()} saveAction={save} />);
    expect(html).toContain("Table T1, 4 seats");
    expect(html).toContain("Place table T2");
    expect(html).not.toContain("Gone");
    expect(html).not.toContain("Old");
    expect(html).toContain("All changes saved");
    expect(html).toContain("Save positions");
  });
  it("is read-only without manage permission", () => {
    const html = renderToStaticMarkup(<FloorPlan data={data({ canManage: false })} saveAction={save} />);
    expect(html).toContain("View only");
    expect(html).not.toContain("Save positions");
    expect(html).not.toContain("position 100, 200");
    expect(html).toMatch(/Place table T2[^>]*|disabled/);
  });
  it("renders empty states", () => {
    expect(renderToStaticMarkup(<FloorPlan data={data({ areas: [] })} saveAction={save} />)).toContain("Add an area");
    expect(renderToStaticMarkup(<FloorPlan data={data({ tables: [] })} saveAction={save} />)).toContain("no active tables");
  });
});
