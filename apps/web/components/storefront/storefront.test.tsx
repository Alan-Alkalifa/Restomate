import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { id as id_ } from "@/i18n/id";
import { PricingGrid } from "../frontend/PricingGrid";
import { StorefrontUnavailable } from "./StorefrontUnavailable";

const fmt = (n: number, c: string) => `${c}:${n}`;
const i18n = { t: en.marketing.pricing, locale: "en" as const, signupEnabled: true };

describe("frontend/storefront views", () => {
  it("renders packages from props with no hard-coded prices", () => {
    const html = renderToStaticMarkup(
      <PricingGrid
        formatMoney={fmt}
        {...i18n}
        packages={[{ code: "pro", name: "Pro", description: null, currency: "IDR", priceMonthly: 12345, priceYearly: 0, trialDays: 14, limits: { locations: 3, staff: null }, features: ["qr_ordering"], isDefault: false }]}
      />,
    );
    expect(html).toContain("IDR:12345");
    expect(html).toContain("14-day free trial");
    expect(html).toContain("Unlimited");
    expect(html).toContain("Start free trial");
  });
  it("translates known limit/feature keys and falls back to humanize for unknown ones", () => {
    const pkg = { code: "p", name: "P", description: null, currency: "IDR", priceMonthly: 1, priceYearly: 0, trialDays: 0, limits: { max_staff: null, max_locations: 3, brand_new_limit: 2 }, features: ["qr_ordering", "some_new_feature"], isDefault: false };
    const id = renderToStaticMarkup(<PricingGrid formatMoney={fmt} packages={[pkg]} t={id_.marketing.pricing} locale="id" signupEnabled />);
    expect(id).toContain("Tanpa batas staf");
    expect(id).toContain("3 lokasi");
    expect(id).toContain("Pemesanan QR");
    expect(id).toContain("2 brand new limit");
    expect(id).toContain("Some new feature");
    expect(id).not.toContain("Max staff");
  });
  it("shows an empty state for no packages", () => {
    expect(renderToStaticMarkup(<PricingGrid packages={[]} formatMoney={fmt} {...i18n} />)).toContain("not available");
  });
  it("unavailable page is noindex", () => {
    expect(renderToStaticMarkup(<StorefrontUnavailable t={en.storefront} />)).toContain('content="noindex"');
    expect(renderToStaticMarkup(<StorefrontUnavailable t={id_.storefront} />)).toContain("Restoran ini sedang tidak tersedia");
  });
});
