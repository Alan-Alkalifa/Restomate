import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { QrSheet } from "./QrSheet";
import { qrSvg } from "./qr-svg";
import { chunk, filterByArea, pageCount, parseLayout, PER_PAGE, type QrCell } from "./sheet";

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
