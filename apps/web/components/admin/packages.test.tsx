// The new ActionErrorCode members arrive with MSS-T01; cast until then.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { PackageForm } from "./PackageForm";
import { PackagesList } from "./PackagesList";
import { failureMessage, fromMinorUnits, previewMoney, toMinorUnitsString } from "./package-form-utils";
import type { AdminPackage } from "@/lib/admin/packages";

const noop = async () => ({ ok: true as const });
const pkg = (o: Partial<AdminPackage> = {}): AdminPackage => ({
  id: "1", code: "pro", name: "Pro", description: null, currency: "IDR", priceMonthly: 250000, priceYearly: 2500000,
  trialDays: 14, limits: { max_locations: 3, max_staff: null, max_tables: 50, max_orders_per_month: null },
  features: ["qr_ordering"], isActive: true, isPublic: true, isDefault: false, sortOrder: 1, subscriptionCount: 4,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...o,
});

describe("price conversion", () => {
  it("turns typed rupiah into digits-only minor units", () => {
    expect(toMinorUnitsString("250.000", "IDR")).toBe("250000");
    expect(toMinorUnitsString(" 250000 ", "IDR")).toBe("250000");
    expect(toMinorUnitsString("0", "IDR")).toBe("0");
    expect(toMinorUnitsString("", "IDR")).toBe("");
  });
  it("handles cents for USD and leaves junk for the server to reject", () => {
    expect(toMinorUnitsString("12.50", "USD")).toBe("1250");
    expect(toMinorUnitsString("12", "USD")).toBe("1200");
    expect(toMinorUnitsString("1e5", "IDR")).toBe("1e5");
    expect(toMinorUnitsString("-5", "IDR")).toBe("-5");
  });
  it("round-trips for prefill", () => {
    expect(fromMinorUnits(250000, "IDR")).toBe("250000");
    expect(fromMinorUnits(1250, "USD")).toBe("12.50");
    expect(fromMinorUnits(5, "USD")).toBe("0.05");
  });
});

describe("price conversion: ambiguous input is never guessed", () => {
  it("accepts plain digits and correct thousand groups, dropping a trailing .00/,00", () => {
    expect(toMinorUnitsString("25.000", "IDR")).toBe("25000");
    expect(toMinorUnitsString("25,000", "IDR")).toBe("25000");
    expect(toMinorUnitsString("1.250.000", "IDR")).toBe("1250000");
    expect(toMinorUnitsString("25.000,00", "IDR")).toBe("25000");
    expect(toMinorUnitsString("1,000.00", "IDR")).toBe("1000");
  });
  it("sends everything else raw so the server returns a field error", () => {
    for (const bad of ["25.000,50", "2.50", "25.00.0", "1.2.3", "1,000.000,000", "1.000,000", "25 000", "1234.567", ".000", "25.0000"]) {
      expect(toMinorUnitsString(bad, "IDR")).toBe(bad);
    }
  });
  it("applies the same grouping rule to the USD whole part", () => {
    expect(toMinorUnitsString("1,000.50", "USD")).toBe("100050");
    expect(toMinorUnitsString("1.000,50", "USD")).toBe("100050");
    expect(toMinorUnitsString("1,000", "USD")).toBe("100000");
    expect(toMinorUnitsString("1,00,0.50", "USD")).toBe("1,00,0.50");
    expect(toMinorUnitsString("12.345", "USD")).toBe("1234500");
    expect(toMinorUnitsString("1 000.50", "USD")).toBe("1 000.50");
  });
  it("previews what will be saved", () => {
    expect(previewMoney("25.000", "IDR")).toMatch(/25\.000/);
    expect(previewMoney("25.000,00", "IDR")).toMatch(/25\.000$/);
    expect(previewMoney("25.000,50", "IDR")).toBeNull();
    expect(previewMoney("abc", "IDR")).toBeNull();
  });
});

describe("failureMessage", () => {
  it("prefers formError, falls back per code", () => {
    expect(failureMessage({ ok: false, formError: "x" })).toBe("x");
    expect(failureMessage({ ok: false, code: "DEFAULT_PACKAGE" as never })).toContain("another plan as the default");
    expect(failureMessage({ ok: true })).toBeUndefined();
  });
});

describe("packages UI", () => {
  it("lists badges, subscriptions and unlimited limits, escaping names", () => {
    const html = renderToStaticMarkup(<PackagesList archive={noop} setDefault={noop} packages={[
      pkg({ name: "<img src=x onerror=alert(1)>", isDefault: true }),
      pkg({ id: "2", isActive: false, isPublic: false }),
    ]} />);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Default");
    expect(html).toContain("Archived");
    expect(html).toContain("Hidden");
    expect(html).toContain("Staff: Unlimited");
    expect(html).toContain("Restore");
  });
  it("renders an empty state", () => {
    expect(renderToStaticMarkup(<PackagesList archive={noop} setDefault={noop} packages={[]} />)).toContain("No plans yet");
  });
  it("create form has an editable code; edit form does not and posts the id", () => {
    expect(renderToStaticMarkup(<PackageForm action={noop} />)).toContain('name="code"');
    const edit = renderToStaticMarkup(<PackageForm action={noop} pkg={pkg()} />);
    expect(edit).not.toContain('name="code"');
    expect(edit).toContain('name="packageId"');
    expect(edit).toContain('name="priceMonthly"');
    expect(edit).toContain('value="250000"');
    expect(edit).toContain('name="limit_max_staff"');
  });
});
