import { brandingToCssVars } from "@/lib/theme";
import type { StorefrontBranding } from "@/lib/storefront/get-storefront";

/**
 * Readable text colour (black or white) on a #rrggbb background, by WCAG relative luminance, so a tenant with a pale
 * primary colour still gets legible buttons. Anything that is not #rrggbb falls back to white.
 */
export function onColor(hex: string): "#000000" | "#ffffff" {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white is 1.05/(L+0.05); with black (L+0.05)/0.05. Pick the larger.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#ffffff" : "#000000";
}

/** Branding -> CSS custom properties for the storefront wrapper. Only sanitised values (see lib/theme) ever reach `style`. */
export function storefrontCssVars(branding: Pick<StorefrontBranding, "primaryColor" | "secondaryColor" | "font">): Record<string, string> {
  const vars = brandingToCssVars(branding);
  return { ...vars, "--brand-on-primary": onColor(vars["--brand-primary"]) };
}
