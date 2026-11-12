import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import type { BoundMenuAction } from "../types";
import { LocationMenu } from "./LocationMenu";
import { formatSoldOutUntil, isSoldOut } from "./time";
import type { LocationMenuActions, LocationMenuData } from "./types";

const act: BoundMenuAction = async () => ({ ok: true });
const actions: LocationMenuActions = { setLocationOverride: act, toggleSoldOut: act, createStation: act, renameStation: act, setStationActive: act };
const NOW = "2026-11-09T08:00:00Z"; // 15:00 in Jakarta
const data = (o: Partial<LocationMenuData> = {}): LocationMenuData => ({
  currency: "IDR", timezone: "Asia/Jakarta", canManage: true, canToggleSoldOut: true,
  stations: [{ id: "s1", name: "Bar", sortOrder: 0, isActive: true }],
  rows: [
    { itemId: "i1", categoryId: "c", name: "<b>Nasi</b>", isPublished: true, isActive: true, basePrice: 35000, priceOverride: 38000, effectivePrice: 38000, isAvailable: true, soldOutUntil: null, kitchenStationId: "s1" },
    { itemId: "i2", categoryId: "c", name: "Mie", isPublished: true, isActive: true, basePrice: 32000, priceOverride: null, effectivePrice: 32000, isAvailable: true, soldOutUntil: "2026-11-09T16:59:59Z", kitchenStationId: null },
  ],
  ...o,
});

describe("sold-out time (location timezone)", () => {
  const now = new Date(NOW);
  it("shows the end of the Jakarta day, not UTC or the browser's zone", () => {
    expect(formatSoldOutUntil("2026-11-09T16:59:59Z", "Asia/Jakarta", now)).toBe("23:59");
    expect(formatSoldOutUntil("2026-11-09T16:59:59Z", "UTC", now)).toBe("16:59");
  });
  it("adds the date when it ends on another local day, and survives a bad zone", () => {
    expect(formatSoldOutUntil("2026-11-10T16:59:59Z", "Asia/Jakarta", now)).toBe("10 Nov 23:59");
    expect(formatSoldOutUntil("2026-11-09T16:59:59Z", "Not/AZone", now)).toBe("16:59");
  });
  it("treats a past end time as not sold out", () => {
    expect(isSoldOut("2026-11-09T16:59:59Z", now)).toBe(true);
    expect(isSoldOut("2026-11-09T07:00:00Z", now)).toBe(false);
    expect(isSoldOut(null, now)).toBe(false);
  });
});

describe("LocationMenu", () => {
  it("managers see overrides, stations, sold-out toggle and the local end time", () => {
    const html = renderToStaticMarkup(<LocationMenu data={data()} actions={actions} nowIso={NOW} />);
    expect(html).toContain("Rp 38.000");
    expect(html).toContain("base Rp 35.000");
    expect(html).not.toContain("<b>Nasi");
    expect(html).toContain("Sold out until 23:59");
    expect(html).toContain("Back on");
    expect(html).toContain("Sold out today");
    expect(html).toContain("Edit &lt;b&gt;Nasi");
    expect(html).toContain("Add station");
  });
  it("a cashier can toggle sold out but sees no override, station or edit controls", () => {
    const html = renderToStaticMarkup(<LocationMenu data={data({ canManage: false })} actions={actions} nowIso={NOW} />);
    expect(html).toContain("Sold out today");
    expect(html).not.toContain("at this location");
    expect(html).not.toContain("Add station");
    expect(html).not.toContain("Rename");
  });
  it("a view-only member has no controls", () => {
    const html = renderToStaticMarkup(<LocationMenu data={data({ canManage: false, canToggleSoldOut: false })} actions={actions} nowIso={NOW} />);
    expect(html).toContain("View only");
    expect(html).not.toContain("Sold out today");
  });
  it("renders empty states", () => {
    expect(renderToStaticMarkup(<LocationMenu data={data({ rows: [], stations: [] })} actions={actions} nowIso={NOW} />)).toContain("no items yet");
    expect(renderToStaticMarkup(<LocationMenu data={data({ stations: [] })} actions={actions} nowIso={NOW} />)).toContain("No stations yet");
  });
});
