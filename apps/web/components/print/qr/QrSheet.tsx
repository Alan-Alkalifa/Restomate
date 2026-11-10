import { FACE_PADDING_MM, PER_PAGE, PRINT_CSS, QR_MM, TENT_FACE, chunk, type Layout, type QrCell } from "./sheet";

type Brand = { orgName: string; locationName: string; logoUrl: string | null };

function Face({ cell, brand, flip, tent }: { cell: QrCell; brand: Brand; flip?: boolean; tent?: boolean }) {
  const qr = tent ? QR_MM.tents : QR_MM.grid;
  // Sizes in mm, from the same constants as the print CSS. Text sits beside the code so the face stays short.
  const f = tent ? { brand: 6, label: 16, area: 5, scan: 6.5, logo: 12 } : { brand: 3.4, label: 8, area: 3, scan: 3.4, logo: 6 };
  return (
    <div className={`face ${flip ? "flip" : ""} flex items-center justify-center gap-[3mm] text-left text-black`}
      style={{ padding: `${FACE_PADDING_MM}mm`, height: tent ? `${TENT_FACE.heightMm}mm` : "100%" }}>
      <div role="img" aria-label={`QR code for table ${cell.label}`} className="shrink-0" style={{ width: `${qr}mm`, height: `${qr}mm` }} dangerouslySetInnerHTML={{ __html: cell.svg }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1mm] overflow-hidden">
        <div className="flex items-center gap-[2mm]">
          {brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- print sheet: a plain https <img> prints reliably; next/image adds nothing here
            <img src={brand.logoUrl} alt="" style={{ height: `${f.logo}mm`, width: "auto" }} />
          )}
          <p className="break-words" style={{ fontWeight: 700, fontSize: `${f.brand}mm`, lineHeight: 1.1 }}>{brand.orgName}</p>
        </div>
        <p style={{ fontWeight: 800, fontSize: `${f.label}mm`, lineHeight: 1 }}>{cell.label}</p>
        <p className="break-words" style={{ fontSize: `${f.area}mm`, lineHeight: 1.1 }}>{cell.areaName} · {brand.locationName}</p>
        <p style={{ fontWeight: 600, fontSize: `${f.scan}mm`, lineHeight: 1.1 }}>Scan to order</p>
      </div>
    </div>
  );
}

/** Server component: receives ready-made SVG strings, renders only HTML (no token ever reaches the client bundle). */
export function QrSheet({ cells, layout, brand }: { cells: QrCell[]; layout: Layout; brand: Brand }) {
  const pages = chunk(cells, PER_PAGE[layout]);
  return (
    <div className="qr-print flex flex-col gap-6 overflow-x-auto print:gap-0 print:overflow-visible" data-layout={layout}>
      <style>{PRINT_CSS}</style>
      {pages.map((page, i) => (
        <section key={i} className={`qr-page ${layout} rounded-lg border border-neutral-300 bg-white print:rounded-none print:border-0`} aria-label={`Page ${i + 1} of ${pages.length}`}>
          {page.map((cell) =>
            layout === "grid" ? (
              <div key={cell.tableId} className="qr-cell rounded border border-dashed border-neutral-400 print:border-neutral-400">
                <Face cell={cell} brand={brand} />
              </div>
            ) : (
              <div key={cell.tableId} className="qr-tent">
                <Face cell={cell} brand={brand} flip tent />
                <Face cell={cell} brand={brand} tent />
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
