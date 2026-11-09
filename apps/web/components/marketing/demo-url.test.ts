import { describe, expect, it } from "vitest";
import { getDemoUrl } from "./demo-url";

describe("getDemoUrl", () => {
  it("builds the demo subdomain from the root domain", () => {
    expect(getDemoUrl("restomate.app")).toBe("https://demo.restomate.app");
  });
  it("falls back to the path-based demo locally or when unset", () => {
    expect(getDemoUrl("localhost")).toBe("/s/demo");
    expect(getDemoUrl("")).toBe("/s/demo");
    expect(getDemoUrl(undefined)).toBe("/s/demo");
  });
});
