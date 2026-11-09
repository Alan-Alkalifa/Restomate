/** Pure layout helpers for the printable QR sheet. */

export type Layout = "grid" | "tents";
export type QrCell = { tableId: string; label: string; areaName: string; svg: string };

/** A4 grid: 2 columns x 4 rows. Tents: 2 folded tents per A4 page. */
export const PER_PAGE: Record<Layout, number> = { grid: 8, tents: 2 };

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const parseLayout = (v: string | string[] | undefined): Layout => (v === "tents" ? "tents" : "grid");

/** `area` is an area name from the data, or empty/"all" for every table. Unknown names select nothing. */
export function filterByArea<T extends { areaName: string }>(rows: readonly T[], area: string | undefined): T[] {
  if (!area || area === "all") return rows.slice();
  return rows.filter((r) => r.areaName === area);
}

export const pageCount = (tables: number, layout: Layout) => Math.ceil(tables / PER_PAGE[layout]);

/**
 * Print CSS. Everything outside `.qr-print` is removed from the printed page (the dashboard chrome), while the
 * ancestors of `.qr-print` are neutralised so no blank leading page or stray padding remains.
 */
export const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
.qr-page { display: grid; gap: 6mm; break-after: page; }
.qr-page:last-child { break-after: auto; }
.qr-page.grid { grid-template-columns: 1fr 1fr; grid-template-rows: repeat(4, 1fr); height: 277mm; }
.qr-page.tents { grid-template-rows: 1fr 1fr; height: 277mm; }
.qr-cell { break-inside: avoid; page-break-inside: avoid; }
.qr-tent { break-inside: avoid; display: grid; grid-template-rows: 1fr 1fr; }
.qr-tent .face.flip { transform: rotate(180deg); border-bottom: 1px dashed #666; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  body :not(.qr-print):not(.qr-print *):not(:has(.qr-print)) { display: none !important; }
  body :has(.qr-print) { display: block !important; padding: 0 !important; margin: 0 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; position: static !important; border: 0 !important; width: auto !important; max-width: none !important; }
  .qr-print { padding: 0 !important; }
  .qr-page { gap: 4mm; }
}
`;
