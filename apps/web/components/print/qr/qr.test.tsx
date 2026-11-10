import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QrSheet } from "./QrSheet";
import { qrSvg } from "./qr-svg";
import { BOX_HEIGHT_MM, FACE_GAP_MM, FACE_PADDING_MM, GRID, MIN_TEXT_MM, GRID_CELL, PAGE, PRINT_CSS, PRINTABLE, QR_MM, TENT, TENT_FACE, TENTS, chunk, filterByArea, pageCount, parseLayout, PER_PAGE, type QrCell } from "./sheet";

const TOKEN = "SECRETtoken123";
const cell = (i: number, area = "Indoor"): QrCell => ({ tableId: `t${i}`, label: `T${i}`, areaName: area, svg: "<svg></svg>" });
const brand = { orgName: "Demo <Resto>", locationName: "Jakarta Selatan", logoUrl: null };

describe("qr generation (server-side SVG)", () => {
  it("returns an SVG and never leaks the token as text", async () => {
    const svg = await qrSvg(`https://demo.restomate.app/t/${TOKEN}`);
    expect(svg.startsWith("<?xml") || svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain(TOKEN);
  });
  it("different urls give different codes", async () => {
    expect(await qrSvg("https://a.example/t/1")).not.toBe(await qrSvg("https://a.example/t/2"));
  });
});

describe("layout helpers", () => {
  it("chunks and counts pages for 60 tables", () => {
    const list = Array.from({ length: 60 }, (_, i) => i);
    expect(chunk(list, PER_PAGE.grid)).toHaveLength(8);
    expect(chunk(list, PER_PAGE.grid)[7]).toHaveLength(4);
    expect(pageCount(60, "grid")).toBe(8);
    expect(pageCount(60, "tents")).toBe(30);
    expect(pageCount(0, "grid")).toBe(0);
  });
  it("filters by area name; unknown selects nothing; all/empty selects everything", () => {
    const rows = [{ areaName: "Indoor" }, { areaName: "Terrace" }];
    expect(filterByArea(rows, "Terrace")).toEqual([{ areaName: "Terrace" }]);
    expect(filterByArea(rows, "all")).toHaveLength(2);
    expect(filterByArea(rows, undefined)).toHaveLength(2);
    expect(filterByArea(rows, "Nope")).toEqual([]);
  });
  it("parses the layout param safely", () => {
    expect(parseLayout("tents")).toBe("tents");
    expect(parseLayout("grid")).toBe("grid");
    expect(parseLayout(["tents"])).toBe("grid");
    expect(parseLayout("<script>")).toBe("grid");
  });
});

describe("QrSheet", () => {
  it("renders 8 cells per A4 page with label, area and Scan to order; escapes names", () => {
    const html = renderToStaticMarkup(<QrSheet cells={Array.from({ length: 9 }, (_, i) => cell(i))} layout="grid" brand={brand} />);
    expect(html.match(/class="qr-page grid/g)).toHaveLength(2);
    expect(html.match(/class="qr-cell/g)).toHaveLength(9);
    expect(html).toContain("Scan to order");
    expect(html).toContain("Demo &lt;Resto&gt;");
    expect(html).not.toContain("Demo <Resto>");
    expect(html).toContain("@page");
    expect(html).toContain("break-inside: avoid");
  });
  it("renders table tents with the QR on both faces", () => {
    const html = renderToStaticMarkup(<QrSheet cells={[cell(1), cell(2), cell(3)]} layout="tents" brand={brand} />);
    expect(html.match(/class="qr-page tents/g)).toHaveLength(2);
    expect(html.match(/class="qr-tent"/g)).toHaveLength(3);
    expect(html.match(/<svg>/g)).toHaveLength(6); // two faces per tent
    expect(html).toContain("flip");
  });
  it("only renders an <img> when a logo is set", () => {
    expect(renderToStaticMarkup(<QrSheet cells={[cell(1)]} layout="grid" brand={brand} />)).not.toContain("<img");
    expect(renderToStaticMarkup(<QrSheet cells={[cell(1)]} layout="grid" brand={{ ...brand, logoUrl: "https://x.example/l.png" }} />)).toContain('src="https://x.example/l.png"');
  });
});

describe("pagination math (one source of truth)", () => {
  const sections = (n: number, layout: "grid" | "tents") =>
    renderToStaticMarkup(<QrSheet cells={Array.from({ length: n }, (_, i) => cell(i))} layout={layout} brand={brand} />).match(/<section /g)?.length ?? 0;
  it("12 tables → 2 grid pages / 6 tent pages; 60 → 8 / 30", () => {
    expect([pageCount(12, "grid"), pageCount(12, "tents")]).toEqual([2, 6]);
    expect([pageCount(60, "grid"), pageCount(60, "tents")]).toEqual([8, 30]);
    expect([pageCount(8, "grid"), pageCount(9, "grid"), pageCount(1, "tents"), pageCount(0, "tents")]).toEqual([1, 2, 1, 0]);
  });
  it("the sheet renders exactly pageCount() pages, so the screen count equals the printed count", () => {
    for (const n of [0, 1, 8, 9, 12, 60]) {
      expect(sections(n, "grid")).toBe(pageCount(n, "grid"));
      expect(sections(n, "tents")).toBe(pageCount(n, "tents"));
    }
  });
  it("every page holds exactly PER_PAGE items except the last", () => {
    const pages = chunk(Array.from({ length: 12 }, (_, i) => i), PER_PAGE.grid);
    expect(pages.map((p) => p.length)).toEqual([8, 4]);
  });
});

describe("page geometry (mm)", () => {
  it("rows, gaps and tents fit inside the printable A4 height with slack", () => {
    expect(PRINTABLE).toEqual({ widthMm: PAGE.widthMm - 20, heightMm: PAGE.heightMm - 20 });
    expect(GRID.rows * GRID_CELL.heightMm + (GRID.rows - 1) * GRID.gapMm).toBeCloseTo(BOX_HEIGHT_MM, 5);
    expect(BOX_HEIGHT_MM).toBeLessThan(PRINTABLE.heightMm); // slack: no blank trailing page from rounding
    expect(TENTS.perPage * TENT.heightMm + (TENTS.perPage - 1) * TENTS.gapMm).toBeCloseTo(BOX_HEIGHT_MM, 5);
    expect(2 * TENT_FACE.heightMm).toBeCloseTo(TENT.heightMm, 5);
    expect(GRID.cols * GRID_CELL.widthMm + (GRID.cols - 1) * GRID.gapMm).toBeCloseTo(PRINTABLE.widthMm, 5);
  });
  it("a QR plus its padding always fits its cell/face (never clipped)", () => {
    expect(QR_MM.grid + 2 * FACE_PADDING_MM).toBeLessThanOrEqual(GRID_CELL.heightMm);
    expect(QR_MM.tents + 2 * FACE_PADDING_MM).toBeLessThanOrEqual(TENT_FACE.heightMm);
    expect(QR_MM.grid).toBeGreaterThanOrEqual(40); // large enough to scan at a table
    expect(QR_MM.grid + 2 * FACE_PADDING_MM + FACE_GAP_MM + MIN_TEXT_MM).toBeLessThanOrEqual(GRID_CELL.widthMm); // room left for the text beside it
  });
  it("print CSS is generated from the constants and has no trailing break or clipping of codes", () => {
    expect(PRINT_CSS).toContain(`height: ${BOX_HEIGHT_MM}mm`);
    expect(PRINT_CSS).toContain(`repeat(${GRID.rows}, ${GRID_CELL.heightMm}mm)`);
    expect(PRINT_CSS).toContain(".qr-page:last-child { break-after: auto");
    expect(PRINT_CSS).toContain("break-inside: avoid");
    expect(PRINT_CSS).not.toMatch(/height: 277mm/);
  });
  it("the QR has a quiet zone of at least 4 modules", async () => {
    const svg = await qrSvg("https://a.example/t/1");
    const side = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
    const first = /stroke="#000000" d="M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/.exec(svg)!; // first dark module
    expect(Number(first[1])).toBeGreaterThanOrEqual(4);
    expect(Number(first[2])).toBeGreaterThanOrEqual(4);
    expect(side).toBeGreaterThan(8);
  });
});
