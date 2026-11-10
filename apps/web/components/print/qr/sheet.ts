/** Pure layout helpers for the printable QR sheet. */

export type Layout = "grid" | "tents";
export type QrCell = { tableId: string; label: string; areaName: string; svg: string };

/**
 * Page geometry in mm: ONE source of truth for the print CSS, the component sizes, the pagination and the
 * "N tables · M pages" line on screen. Everything below is derived from the printable A4 height, so a page can never
 * hold more than it fits (a fixed height plus taller content clipped rows and added a blank page, BUG-81-1/2).
 */
export const PAGE = { widthMm: 210, heightMm: 297, marginMm: 10 } as const;
export const PRINTABLE = { widthMm: PAGE.widthMm - 2 * PAGE.marginMm, heightMm: PAGE.heightMm - 2 * PAGE.marginMm } as const;
/** The page box is a little shorter than the printable area so rounding can never push a blank page. */
export const SLACK_MM = 1;
export const BOX_HEIGHT_MM = PRINTABLE.heightMm - SLACK_MM;

export const GRID = { cols: 2, rows: 4, gapMm: 4 } as const;
export const TENTS = { perPage: 2, gapMm: 6 } as const;

export const GRID_CELL = {
  widthMm: (PRINTABLE.widthMm - (GRID.cols - 1) * GRID.gapMm) / GRID.cols,
  heightMm: (BOX_HEIGHT_MM - (GRID.rows - 1) * GRID.gapMm) / GRID.rows,
} as const;
/** A tent is two faces (one rotated 180 degrees) stacked in one tent-high block. */
export const TENT = { widthMm: PRINTABLE.widthMm, heightMm: (BOX_HEIGHT_MM - (TENTS.perPage - 1) * TENTS.gapMm) / TENTS.perPage } as const;
export const TENT_FACE = { widthMm: TENT.widthMm, heightMm: TENT.heightMm / 2 } as const;

/**
 * QR side in mm per face type: limited by the face height (minus padding) and, for the grid, by the cell width minus
 * the padding, the gap and a minimum column of text beside the code. So the code never touches an edge or crowds the text.
 */
export const FACE_PADDING_MM = 3;
export const FACE_GAP_MM = 3;
export const MIN_TEXT_MM = 30;
export const QR_MM = {
  grid: Math.floor(Math.min(GRID_CELL.heightMm - 2 * FACE_PADDING_MM, GRID_CELL.widthMm - 2 * FACE_PADDING_MM - FACE_GAP_MM - MIN_TEXT_MM)),
  tents: Math.floor(TENT_FACE.heightMm - 2 * FACE_PADDING_MM),
} as const;

/** A4 grid: 2 columns x 4 rows. Tents: 2 folded tents per A4 page. */
export const PER_PAGE: Record<Layout, number> = { grid: GRID.cols * GRID.rows, tents: TENTS.perPage };

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
 * Print CSS, generated from the constants above. Everything outside `.qr-print` is removed from the printed page (the
 * dashboard chrome), while the ancestors of `.qr-print` are neutralised so no blank leading page or stray padding
 * remains. Every page is a fixed-size box (`overflow: hidden` on the box only, never on a QR); only the last page has
 * no `break-after`, so there is no trailing blank page.
 */
export const PRINT_CSS = `
@page { size: A4; margin: ${PAGE.marginMm}mm; }
.qr-page { box-sizing: border-box; display: grid; overflow: hidden; break-after: page; page-break-after: always; width: ${PRINTABLE.widthMm}mm; max-width: 100%; height: ${BOX_HEIGHT_MM}mm; }
.qr-page:last-child { break-after: auto; page-break-after: auto; }
.qr-page.grid { grid-template-columns: repeat(${GRID.cols}, ${GRID_CELL.widthMm}mm); grid-template-rows: repeat(${GRID.rows}, ${GRID_CELL.heightMm}mm); gap: ${GRID.gapMm}mm; }
.qr-page.tents { grid-template-rows: repeat(${TENTS.perPage}, ${TENT.heightMm}mm); gap: ${TENTS.gapMm}mm; }
.qr-cell { box-sizing: border-box; overflow: hidden; break-inside: avoid; page-break-inside: avoid; height: ${GRID_CELL.heightMm}mm; }
.qr-tent { box-sizing: border-box; overflow: hidden; break-inside: avoid; page-break-inside: avoid; display: grid; grid-template-rows: ${TENT_FACE.heightMm}mm ${TENT_FACE.heightMm}mm; height: ${TENT.heightMm}mm; }
.qr-tent .face { box-sizing: border-box; overflow: hidden; }
.qr-tent .face.flip { transform: rotate(180deg); border-bottom: 1px dashed #666; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  body :not(.qr-print):not(.qr-print *):not(:has(.qr-print)) { display: none !important; }
  body :has(.qr-print) { display: block !important; padding: 0 !important; margin: 0 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; position: static !important; border: 0 !important; width: auto !important; max-width: none !important; }
  .qr-print { padding: 0 !important; gap: 0 !important; }
}
`;
