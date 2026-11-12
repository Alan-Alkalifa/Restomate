import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import { PricingGrid } from "../frontend/PricingGrid";

const fmt = (n: number, c: string) => `${c}:${n}`;
const plan = (limits: Record<string, number | null>) => ({ code: "p", name: "P", description: null, currency: "IDR", priceMonthly: 1000, priceYearly: 0, trialDays: 0, limits, features: [], isDefault: false });
const render = (limits: Record<string, number | null>, locale: "id" | "en") =>
  renderToStaticMarkup(<PricingGrid formatMoney={fmt} packages={[plan(limits)]} t={(locale === "id" ? id : en).marketing.pricing} locale={locale} signupEnabled />);

describe("limit lines are plural-aware in English (BUG-130-3)", () => {
  it("1 is singular, everything else is plural, for every known limit key", () => {
    const one = render({ max_locations: 1, max_staff: 1, max_tables: 1, max_orders_per_month: 1 }, "en");
    for (const s of ["1 location<", "1 staff member<", "1 table<", "1 order per month<"]) expect(one).toContain(s);
    expect(one).not.toMatch(/1 locations|1 staff members|1 tables|1 orders per month/);
    const many = render({ max_locations: 2, max_staff: 10, max_tables: 0, max_orders_per_month: 500 }, "en");
    for (const s of ["2 locations<", "10 staff members<", "0 tables<", "500 orders per month<"]) expect(many).toContain(s);
  });
  it("unlimited stays plural, and an unknown key falls back to a humanized label", () => {
    expect(render({ max_locations: null }, "en")).toContain("Unlimited locations<");
    expect(render({ brand_new_limit: 1 }, "en")).toContain("1 brand new limit<");
  });
  it("Bahasa Indonesia is unchanged: no plural form, 1 and 2 use the same word", () => {
    const html = render({ max_locations: 1, max_staff: 2 }, "id");
    expect(html).toContain("1 lokasi<");
    expect(html).toContain("2 staf<");
    expect(render({ max_locations: 3 }, "id")).toContain("3 lokasi<");
  });
  it("both dictionaries define the same singular keys as the plural ones", () => {
    for (const d of [en, id]) expect(Object.keys(d.marketing.pricing.limitsOne).sort()).toEqual(Object.keys(d.marketing.pricing.limits).sort());
  });
});
