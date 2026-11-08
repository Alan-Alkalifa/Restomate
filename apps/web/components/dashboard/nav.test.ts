import { describe, expect, it } from "vitest";
import { navHref, resolveNav } from "./nav";

const base = { package: { features: [] } as never };

describe("resolveNav", () => {
  it("hides items without permission", () => {
    const keys = resolveNav({ ...base, permissions: ["pos.use", "orders.view"] }).map((i) => i.key);
    expect(keys).toEqual(["pos", "orders"]);
  });
  it("locks items whose package feature is missing, and unlocks when present", () => {
    const perms = ["reports.view"];
    expect(resolveNav({ ...base, permissions: perms })[0].locked).toBe(true);
    expect(resolveNav({ package: { features: ["advanced_reports"] } as never, permissions: perms })[0].locked).toBe(false);
  });
  it("treats a null package as having no features", () => {
    expect(resolveNav({ package: null, permissions: ["reports.view"] })[0].locked).toBe(true);
  });
  it("builds location-scoped and org-scoped hrefs", () => {
    const [pos] = resolveNav({ ...base, permissions: ["pos.use"] });
    const [staff] = resolveNav({ ...base, permissions: ["staff.manage"] });
    expect(navHref(pos, "demo", "loc-1")).toBe("/demo/loc-1/pos");
    expect(navHref(staff, "demo", "loc-1")).toBe("/demo/staff");
    expect(navHref(pos, "demo", null)).toBe("/demo");
  });
});
