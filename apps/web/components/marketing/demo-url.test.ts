import { afterEach, describe, expect, it, vi } from "vitest";
import { getDemoUrl } from "./demo-url";

describe("getDemoUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the demo subdomain from the root domain", () => {
    expect(getDemoUrl("restomate.app")).toBe("https://demo.restomate.app");
  });
  it("uses the path-based demo on *.vercel.app (no wildcard DNS) and on localhost with a port", () => {
    expect(getDemoUrl("restomate-staging.vercel.app")).toBe("/s/demo");
    expect(getDemoUrl("Restomate.Vercel.App")).toBe("/s/demo");
    expect(getDemoUrl("localhost:3000")).toBe("/s/demo");
  });
  it("does not treat a lookalike domain as vercel.app or localhost", () => {
    expect(getDemoUrl("vercel.app.example.com")).toBe("https://demo.vercel.app.example.com");
    expect(getDemoUrl("localhost.example.com")).toBe("https://demo.localhost.example.com");
  });
  it("falls back to the path-based demo locally or when unset", () => {
    expect(getDemoUrl("localhost")).toBe("/s/demo");
    expect(getDemoUrl("")).toBe("/s/demo");
  });
  it("reads NEXT_PUBLIC_ROOT_DOMAIN when no argument is given", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate.app");
    expect(getDemoUrl()).toBe("https://demo.restomate.app");
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "");
    expect(getDemoUrl()).toBe("/s/demo");
  });
});
