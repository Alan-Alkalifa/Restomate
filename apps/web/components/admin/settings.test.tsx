import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { en } from "@/i18n/en";
import { SignupClosed } from "@/components/auth/SignupClosed";
import { PlatformBanner } from "@/components/ui/PlatformBanner";
import { DEFAULT_PLATFORM_SETTINGS as S } from "@/lib/admin/platform-settings-schemas";
import { BannerForm, OwnedOrgCapForm, SignupForm, TaxPresetsForm, settingsFailure } from "./SettingsForms";
import { bpsToPercent, capInRange, parsePercentToBps, previewPercent } from "./settings-utils";

const noop = async () => ({ ok: true as const });
const names = (html: string) => [...html.matchAll(/<(?:input|textarea|select)[^>]*\sname="([^"]+)"/g)].map((m) => m[1]).sort();

describe("percent → bps (never guess)", () => {
  it("accepts plain percents with up to two decimals", () => {
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("5.5")).toBe(550);
    expect(parsePercentToBps("12,25")).toBe(1225);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("100")).toBe(10000);
    expect(parsePercentToBps(" 7 ")).toBe(700);
  });
  it("rejects anything ambiguous or out of range", () => {
    for (const bad of ["", "10%", "1.000", "1,000", "100.01", "101", "-1", "1e1", "1.2.3", "10.", ".5", "5.555", "1 0", "abc"]) {
      expect(parsePercentToBps(bad), bad).toBeNull();
    }
  });
  it("previews and round-trips", () => {
    expect(previewPercent("10")).toBe("10%");
    expect(previewPercent("5,5")).toBe("5.5%");
    expect(previewPercent("1.000")).toBeNull();
    expect(bpsToPercent(1000)).toBe("10");
    expect(bpsToPercent(550)).toBe("5.5");
    expect(bpsToPercent(1225)).toBe("12.25");
    expect(bpsToPercent(5)).toBe("0.05");
  });
  it("checks the owned-org cap range", () => {
    expect(capInRange("1")).toBe(true);
    expect(capInRange("100")).toBe(true);
    expect(capInRange("0")).toBe(false);
    expect(capInRange("101")).toBe(false);
    expect(capInRange("3.5")).toBe(false);
  });
});

describe("forms post only the contract's fields", () => {
  it("signup / banner / presets / cap", () => {
    expect(names(renderToStaticMarkup(<SignupForm action={noop} initial={S.signup} />))).toEqual(["enabled"]);
    expect(names(renderToStaticMarkup(<BannerForm action={noop} initial={S.maintenanceBanner} />))).toEqual(["enabled", "level", "message"]);
    expect(names(renderToStaticMarkup(<TaxPresetsForm action={noop} initial={S.taxPresets} />))).toEqual(["defaultCode", "defaultCode", "presets"]);
    expect(names(renderToStaticMarkup(<OwnedOrgCapForm action={noop} initial={S.ownedOrgCap} />))).toEqual(["max"]);
  });
  it("posts integer bps in the presets JSON", () => {
    const html = renderToStaticMarkup(<TaxPresetsForm action={noop} initial={S.taxPresets} />);
    const json = /name="presets" value="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"');
    const rows = JSON.parse(json);
    expect(rows[1]).toMatchObject({ code: "pb1_10_sc5", taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true });
    expect(html).toContain("Saves as 10%");
    expect(html).toContain("Saves as 5%");
  });
  it("sends unreadable rates raw so the server rejects them", () => {
    const bad = { ...S.taxPresets, presets: [{ ...S.taxPresets.presets[0], taxRateBps: 123456 }] };
    // 1234.56% cannot be typed back into the field: it is prefilled as text and flagged, and posted as a string
    const html = renderToStaticMarkup(<TaxPresetsForm action={noop} initial={bad} />);
    const rows = JSON.parse(/name="presets" value="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"'));
    expect(rows[0].taxRateBps).toBe("1234.56");
    expect(html).toContain("Can&#x27;t read this rate");
  });
  it("shows the live counter and current values", () => {
    const html = renderToStaticMarkup(<BannerForm action={noop} initial={{ enabled: true, message: "Back at 10", level: "warning" }} />);
    expect(html).toContain("190 characters left");
    expect(html).toContain("Back at 10");
  });
});

describe("error messages", () => {
  it("prefers formError and maps codes", () => {
    expect(settingsFailure({ ok: false, formError: "That value isn't allowed." })).toBe("That value isn't allowed.");
    expect(settingsFailure({ ok: false, code: "FORBIDDEN" })).toBe("You don't have access to do that.");
    expect(settingsFailure({ ok: false, code: "SIGNUP_DISABLED" as never })).toBe("Sign-ups are closed right now.");
    expect(settingsFailure({ ok: false })).toBe("Could not save the setting. Try again.");
    expect(settingsFailure({ ok: true })).toBeUndefined();
  });
});

describe("public banner", () => {
  it("renders nothing when null, disabled or empty", () => {
    expect(renderToStaticMarkup(<PlatformBanner banner={null} />)).toBe("");
    expect(renderToStaticMarkup(<PlatformBanner banner={{ enabled: false, message: "x", level: "info" }} />)).toBe("");
    expect(renderToStaticMarkup(<PlatformBanner banner={{ enabled: true, message: "", level: "info" }} />)).toBe("");
  });
  it("uses status for info and alert for warning", () => {
    expect(renderToStaticMarkup(<PlatformBanner banner={{ enabled: true, message: "hi", level: "info" }} />)).toContain('role="status"');
    expect(renderToStaticMarkup(<PlatformBanner banner={{ enabled: true, message: "hi", level: "warning" }} />)).toContain('role="alert"');
  });
  it("renders the message as text, never HTML", () => {
    const html = renderToStaticMarkup(<PlatformBanner banner={{ enabled: true, message: "<img src=x onerror=alert(1)>", level: "info" }} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("signup closed", () => {
  it("shows the closed message and a sign-in link", () => {
    const html = renderToStaticMarkup(<SignupClosed t={en.auth.signupClosed} locale="en" />);
    expect(html).toContain("Sign-ups are closed right now.");
    expect(html).toContain('href="/login"');
  });
  it("login hides the create-account link only when closed", () => {
    expect(renderToStaticMarkup(<LoginForm action={noop} t={en.auth.login} locale="en" />)).toContain('href="/signup"');
    expect(renderToStaticMarkup(<LoginForm action={noop} t={en.auth.login} locale="en" signupOpen={false} />)).not.toContain('href="/signup"');
  });
});
