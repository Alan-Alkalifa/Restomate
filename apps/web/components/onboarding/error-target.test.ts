import { describe, expect, it } from "vitest";
import { errorTarget } from "./error-target";

describe("errorTarget", () => {
  it("sends a slug-taken race back to step 1 with a clear alert", () => {
    expect(errorTarget({ slug: ["That web address is already taken. Try another."] })).toEqual({
      step: 1,
      field: "slug",
      alert: "That web address was just taken. Please choose another.",
    });
  });
  it("maps location.* to step 2 and the matching input", () => {
    expect(errorTarget({ "location.taxRateBps": ["Must be 2500 (25%) or less."] })).toEqual({
      step: 2,
      field: "tax",
      alert: "Must be 2500 (25%) or less.",
    });
    expect(errorTarget({ location: ["Check the location details and try again."] })).toMatchObject({ step: 2, field: undefined });
  });
  it("maps branding errors to step 3", () => {
    expect(errorTarget({ "branding.logoUrl": ["The logo URL must start with https://"] })).toMatchObject({ step: 3, field: "logoUrl" });
  });
  it("picks the earliest step when several fail", () => {
    expect(errorTarget({ "location.name": ["x"], slug: ["That web address is reserved. Try another."], "branding.logoUrl": ["y"] })).toMatchObject({
      step: 1,
      field: "slug",
    });
  });
  it("returns null without field errors", () => {
    expect(errorTarget(undefined)).toBeNull();
    expect(errorTarget({ slug: [] })).toBeNull();
  });
});
