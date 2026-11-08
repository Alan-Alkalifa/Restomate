import type { StorefrontBranding } from "@/lib/storefront/get-storefront";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_PRIMARY = "#0f766e";
export const DEFAULT_SECONDARY = "#134e4a";
export const DEFAULT_FONT = "ui-sans-serif, system-ui, sans-serif";

/** Allow-listed font families (lowercase key -> CSS stack). Anything else falls back. */
const FONTS: Record<string, string> = {
  inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
  roboto: 'Roboto, ui-sans-serif, system-ui, sans-serif',
  "open sans": '"Open Sans", ui-sans-serif, system-ui, sans-serif',
  poppins: 'Poppins, ui-sans-serif, system-ui, sans-serif',
  montserrat: 'Montserrat, ui-sans-serif, system-ui, sans-serif',
  lora: 'Lora, ui-serif, Georgia, serif',
  "playfair display": '"Playfair Display", ui-serif, Georgia, serif',
};

export const ALLOWED_FONTS = Object.keys(FONTS);

/** Branding -> CSS custom properties. Only #rrggbb colours and allow-listed fonts pass. */
export function brandingToCssVars(b: Pick<StorefrontBranding, "primaryColor" | "secondaryColor" | "font">): Record<string, string> {
  const color = (v: string | null, fallback: string) => (v && HEX.test(v) ? v.toLowerCase() : fallback);
  const font = b.font ? FONTS[b.font.trim().toLowerCase()] : undefined;
  return {
    "--brand-primary": color(b.primaryColor, DEFAULT_PRIMARY),
    "--brand-secondary": color(b.secondaryColor, DEFAULT_SECONDARY),
    "--brand-font": font ?? DEFAULT_FONT,
  };
}
