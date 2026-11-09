import { PER_PAGE, PRINT_CSS, chunk, type Layout, type QrCell } from "./sheet";

type Brand = { orgName: string; locationName: string; logoUrl: string | null };

function Face({ cell, brand, flip, big }: { cell: QrCell; brand: Brand; flip?: boolean; big?: boolean }) {
  return (
    <div className={`face ${flip ? "flip" : ""} flex flex-col items-center justify-center gap-1 text-center text-black`} style={{ padding: "4mm" }}>
      <div className="flex items-center gap-2">
        {brand.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- print sheet: a plain https <img> prints reliably; next/image adds nothing here
          <img src={brand.logoUrl} alt="" style={{ height: big ? "14mm" : "9mm", width: "auto" }} />
        )}
        <p style={{ fontWeight: 700, fontSize: big ? "6mm" : "4.2mm" }}>{brand.orgName}</p>
      </div>
      <div role="img" aria-label={`QR code for table ${cell.label}`} style={{ width: big ? "62mm" : "48mm", height: big ? "62mm" : "48mm" }} dangerouslySetInnerHTML={{ __html: cell.svg }} />
      <p style={{ fontWeight: 800, fontSize: big ? "11mm" : "8mm", lineHeight: 1 }}>{cell.label}</p>
      <p style={{ fontSize: big ? "4.5mm" : "3.6mm" }}>{cell.areaName} · {brand.locationName}</p>
      <p style={{ fontWeight: 600, fontSize: big ? "5mm" : "4mm" }}>Scan to order</p>
    </div>
  );
}

/** Server component: receives ready-made SVG strings, renders only HTML (no token ever reaches the client bundle). */
export function QrSheet({ cells, layout, brand }: { cells: QrCell[]; layout: Layout; brand: Brand }) {
  const pages = chunk(cells, PER_PAGE[layout]);
  return (
    <div className="qr-print flex flex-col gap-6" data-layout={layout}>
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
                <Face cell={cell} brand={brand} flip big />
                <Face cell={cell} brand={brand} big />
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
