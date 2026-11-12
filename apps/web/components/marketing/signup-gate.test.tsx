import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import { PricingGrid } from "../frontend/PricingGrid";
import { CtaButtons } from "./CtaButtons";
import { MarketingFooter } from "./MarketingFooter";
import { MarketingHeader } from "./MarketingHeader";
import { SignupGate, SignupGateContent } from "./SignupGate";

const flags = vi.hoisted(() => ({ signupEnabled: true }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/public/platform-flags", () => ({
  getPublicPlatformFlags: async () => ({ signupEnabled: flags.signupEnabled, maintenanceBanner: null }),
}));

const signupLinks = (html: string) => html.match(/<a [^>]*href="[^"]*\/signup"/g) ?? [];
const fmt = (n: number, c: string) => `${c}:${n}`;
const pkg = (code: string) => ({ code, name: `Plan ${code}`, description: null, currency: "IDR", priceMonthly: 1000, priceYearly: 0, trialDays: 14, limits: {}, features: [], isDefault: false });
const packages = [pkg("a"), pkg("b"), pkg("c")];

describe("PricingGrid with sign-ups closed (BUG-100-1)", () => {
  for (const [locale, dict] of [["en", en], ["id", id]] as const) {
    it(`${locale}: no signup link on any plan card, plans stay visible, closed label shown`, () => {
      const html = renderToStaticMarkup(<PricingGrid packages={packages} formatMoney={fmt} t={dict.marketing.pricing} locale={locale} signupEnabled={false} />);
      expect(signupLinks(html)).toHaveLength(0);
      expect(html).not.toContain("/signup");
      for (const p of packages) expect(html).toContain(p.name);
      expect(html.split(dict.marketing.pricing.signupClosed)).toHaveLength(packages.length + 1);
      expect(html).not.toContain(dict.marketing.pricing.cta);
    });
    it(`${locale}: open → one signup link per card, in the right language`, () => {
      const html = renderToStaticMarkup(<PricingGrid packages={packages} formatMoney={fmt} t={dict.marketing.pricing} locale={locale} signupEnabled />);
      expect(signupLinks(html)).toHaveLength(3);
      expect(html).toContain(locale === "en" ? 'href="/en/signup"' : 'href="/signup"');
      expect(html).not.toContain(dict.marketing.pricing.signupClosed);
    });
  }
});

describe("SignupGate (BUG-100-2): the server decides, the initial HTML never has the link", () => {
  beforeEach(() => { flags.signupEnabled = true; });

  it("the Suspense fallback is empty, so the first HTML cannot contain the link", () => {
    const el = SignupGate({ children: <a href="/signup">Sign up</a> });
    expect(el.props.fallback).toBeNull();
    const html = renderToStaticMarkup(<SignupGate><a href="/signup">Sign up</a></SignupGate>);
    expect(html).not.toContain("/signup");
  });
  it("renders the children only when the server-read flag says open", async () => {
    const child = <a href="/signup">Sign up</a>;
    flags.signupEnabled = true;
    expect(await SignupGateContent({ children: child })).toBe(child);
    flags.signupEnabled = false;
    expect(await SignupGateContent({ children: child })).toBeNull();
  });
  it("header, footer and CTA buttons have no signup link in the server HTML, in both languages", () => {
    for (const [locale, dict] of [["en", en], ["id", id]] as const) {
      for (const el of [
        <MarketingHeader key="h" t={dict.marketing} locale={locale} />,
        <MarketingFooter key="f" t={dict.marketing} locale={locale} />,
        <CtaButtons key="c" cta={dict.marketing.cta} locale={locale} />,
      ]) {
        const html = renderToStaticMarkup(el);
        expect(signupLinks(html), `${locale} ${el.type.name}`).toHaveLength(0);
      }
    }
  });
});
