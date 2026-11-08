import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingGrid } from "../frontend/PricingGrid";
import { StorefrontHome, StorefrontUnavailable } from "./StorefrontHome";

const fmt = (n: number, c: string) => `${c}:${n}`;

describe("frontend/storefront views", () => {
  it("renders packages from props with no hard-coded prices", () => {
    const html = renderToStaticMarkup(
      <PricingGrid
        formatMoney={fmt}
        packages={[{ code: "pro", name: "Pro", description: null, currency: "IDR", priceMonthly: 12345, priceYearly: 0, trialDays: 14, limits: { locations: 3, staff: null }, features: ["qr_ordering"], isDefault: false }]}
      />,
    );
    expect(html).toContain("IDR:12345");
    expect(html).toContain("14-day free trial");
    expect(html).toContain("Unlimited staff");
    expect(html).toContain("Start free trial");
  });
  it("shows an empty state for no packages", () => {
    expect(renderToStaticMarkup(<PricingGrid packages={[]} formatMoney={fmt} />)).toContain("not available");
  });
  it("storefront shows locations and applies css vars", () => {
    const html = renderToStaticMarkup(
      <StorefrontHome cssVars={{ "--sf-background": "#fff" }} data={{ status: "active", name: "Demo", slug: "demo", branding: { logoUrl: "https://cdn.example.com/l.png", primaryColor: null, secondaryColor: null, font: null, theme: {} }, locations: [{ name: "Kemang", address: "Jl. A", city: "Jakarta", phone: "021", timezone: "Asia/Jakarta" }] }} />,
    );
    expect(html).toContain("Kemang");
    expect(html).toContain("https://cdn.example.com/l.png");
    expect(html).toContain("--sf-background");
    expect(html).toContain("Menu coming soon");
  });
  it("unavailable page is noindex", () => {
    expect(renderToStaticMarkup(<StorefrontUnavailable />)).toContain('content="noindex"');
  });
});
