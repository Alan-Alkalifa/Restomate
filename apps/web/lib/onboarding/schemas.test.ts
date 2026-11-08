import { describe, expect, it } from "vitest";
import { dottedFieldErrors, onboardingSchema } from "./schemas";

const valid = {
  name: "Warung Sedap",
  slug: "warung-sedap",
  location: { name: "Main", address: "", city: "", phone: "", timezone: "Asia/Jakarta", currency: "IDR", taxRateBps: 1000, serviceChargeBps: 0, taxOnServiceCharge: true },
  branding: { primaryColor: "#1a2b3c", logoUrl: "https://cdn.example.com/l.png" },
};
const withLoc = (o: object) => ({ ...valid, location: { ...valid.location, ...o } });

describe("onboardingSchema", () => {
  it("accepts a valid input and null branding", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...valid, branding: null }).success).toBe(true);
  });
  it("ignores unknown keys such as organization_id / role / package_code", () => {
    const r = onboardingSchema.parse({ ...valid, organization_id: "x", role: "owner", package_code: "pro" });
    expect(r).not.toHaveProperty("organization_id");
    expect(r).not.toHaveProperty("package_code");
  });
  it.each([-1, 2501, 10.5])("rejects tax bps %s", (bps) => {
    const r = onboardingSchema.safeParse(withLoc({ taxRateBps: bps }));
    expect(r.success).toBe(false);
    if (!r.success) expect(dottedFieldErrors(r.error)).toHaveProperty(["location.taxRateBps"]);
  });
  it("rejects bad slug, name, timezone, currency", () => {
    expect(onboardingSchema.safeParse({ ...valid, slug: "-bad" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, name: "x" }).success).toBe(false);
    expect(onboardingSchema.safeParse(withLoc({ timezone: "Mars/Base" })).success).toBe(false);
    expect(onboardingSchema.safeParse(withLoc({ currency: "EUR" })).success).toBe(false);
  });
  it("rejects http/javascript logo URLs, long URLs and bad colours", () => {
    for (const logoUrl of ["http://x.test/a.png", "javascript:alert(1)", "https://x.test/" + "a".repeat(500)]) {
      expect(onboardingSchema.safeParse({ ...valid, branding: { primaryColor: null, logoUrl } }).success).toBe(false);
    }
    expect(onboardingSchema.safeParse({ ...valid, branding: { primaryColor: "red", logoUrl: null } }).success).toBe(false);
  });
  it("uses dotted paths", () => {
    const r = onboardingSchema.safeParse({ ...valid, branding: { primaryColor: "red", logoUrl: null } });
    if (!r.success) expect(Object.keys(dottedFieldErrors(r.error))).toContain("branding.primaryColor");
  });
});
