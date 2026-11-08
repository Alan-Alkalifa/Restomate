import { describe, expect, it } from "vitest";
import { brandingToCssVars } from "./theme";

const b = (o: Partial<Parameters<typeof brandingToCssVars>[0]> = {}) =>
  brandingToCssVars({ primaryColor: null, secondaryColor: null, font: null, ...o });

describe("brandingToCssVars", () => {
  it("falls back to the default palette", () => {
    expect(b()).toEqual({
      "--brand-primary": "#0f766e",
      "--brand-secondary": "#134e4a",
      "--brand-font": "ui-sans-serif, system-ui, sans-serif",
    });
  });
  it("passes valid colours (normalised) and allow-listed fonts", () => {
    const v = b({ primaryColor: "#D97706", secondaryColor: "#112233", font: " Playfair Display " });
    expect(v["--brand-primary"]).toBe("#d97706");
    expect(v["--brand-secondary"]).toBe("#112233");
    expect(v["--brand-font"]).toContain("Playfair Display");
  });
  it.each([
    "red; background:url(https://evil.example/x)",
    "#fff",
    "#12345g",
    "rgb(0,0,0)",
    "#112233; color:red",
    "url(javascript:alert(1))",
    "",
  ])("rejects colour %j", (c) => {
    const v = b({ primaryColor: c, secondaryColor: c });
    expect(v["--brand-primary"]).toBe("#0f766e");
    expect(v["--brand-secondary"]).toBe("#134e4a");
  });
  it.each(["Comic Sans", "Inter; background:url(x)", "}</style><script>", "inherit"])("rejects font %j", (f) => {
    expect(b({ font: f })["--brand-font"]).toBe("ui-sans-serif, system-ui, sans-serif");
  });
  it("only emits the three --brand-* variables", () => {
    expect(Object.keys(b({ primaryColor: "#112233" })).sort()).toEqual(["--brand-font", "--brand-primary", "--brand-secondary"]);
  });
});
