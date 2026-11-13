import type { CSSProperties } from "react";
import type { StorefrontDictionary } from "@/i18n/types";

/**
 * Branded page frame. Branding is applied ONLY as sanitised CSS variables on this wrapper (no per-tenant branches, no
 * Restomate admin chrome). Colours and the font come from `storefrontCssVars`; the logo is an https URL or nothing.
 */
export function StorefrontShell({ name, logoUrl, cssVars, locale, t, languageHref, children }: {
  name: string; logoUrl: string | null; cssVars: Record<string, string>; locale: "id" | "en"; t: StorefrontDictionary;
  /** Where the OTHER language lives (same page, other prefix). */
  languageHref: string; children: React.ReactNode;
}) {
  const other = locale === "id" ? "en" : "id";
  return (
    <div style={cssVars as CSSProperties} className="flex min-h-dvh flex-1 flex-col bg-white text-neutral-900 [font-family:var(--brand-font)]">
      <a href="#menu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-3 focus:underline">{t.skip}</a>
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied remote logo; the host is not known at build time
          <img src={logoUrl} alt="" width={48} height={48} className="size-12 shrink-0 object-contain" />
        ) : null}
        <h1 className="min-w-0 flex-1 text-xl font-bold tracking-tight break-words [color:var(--brand-primary)]">{name}</h1>
        {/* A real navigation (not a client transition): the page's <html lang> follows the document. */}
        <a href={languageHref} lang={other} hrefLang={other} className="flex min-h-12 items-center rounded-lg px-3 text-sm font-medium underline" aria-label={`${t.language.label}: ${t.language[other]}`}>
          {t.language[other]}
        </a>
      </header>
      <main id="menu" className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
