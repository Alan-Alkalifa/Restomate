import { describe, expect, it } from "vitest";
import { sanitizeNext } from "./redirect";

describe("sanitizeNext", () => {
  it.each([
    ["/onboarding", "/onboarding"],
    ["/invite/abc?x=1#y", "/invite/abc?x=1#y"],
    ["/", "/"],
    ["/invite/3f9a-TOKEN_x.y~z", "/invite/3f9a-TOKEN_x.y~z"],
    ["/%2f%2fevil.test", "/%2f%2fevil.test"], // stays a path on our origin
  ])("keeps %s", (input, out) => expect(sanitizeNext(input)).toBe(out));

  it.each([
    "https://evil.test",
    "//evil.test",
    "///evil.test",
    "/\\\\evil.test",
    "/\t/evil.test",
    "/\\evil.test",
    "javascript:alert(1)",
    "relative/path",
    "/a\nb",
    "",
    "/" + "a".repeat(2100),
  ])("rejects %j", (input) => expect(sanitizeNext(input, "/fallback")).toBe("/fallback"));

  it("handles null/undefined and the default fallback", () => {
    expect(sanitizeNext(null)).toBe("/");
    expect(sanitizeNext(undefined, "/x")).toBe("/x");
  });
});
