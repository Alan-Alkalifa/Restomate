import { printCss, type PrintSize, type Receipt } from "./bill-print-model";

/** Renders a ready-made receipt at 80 or 58 mm. Pure presentation: no money is computed here. */
export function BillReceipt({ receipt, size, logoUrl }: { receipt: Receipt; size: PrintSize; logoUrl: string | null }) {
  return (
    <article className="bill-receipt mx-auto bg-white p-0 text-black" data-size={size} aria-label={receipt.title}>
      <style>{printCss(size)}</style>
      {receipt.duplicateMark ? (
        <p className="r-duplicate" style={{ border: "2px solid #000", textAlign: "center", fontWeight: 800, letterSpacing: "0.2em", padding: "1mm 0", margin: "0 0 2mm" }}>
          {receipt.duplicateMark}
        </p>
      ) : null}
      <header style={{ textAlign: "center" }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- receipt: a plain https <img> prints reliably; next/image adds nothing here
          <img src={logoUrl} alt="" style={{ maxHeight: "14mm", maxWidth: "40mm", margin: "0 auto 1mm", filter: "grayscale(1)" }} />
        ) : null}
        <p style={{ fontWeight: 800, fontSize: "1.2em" }}>{receipt.header.name}</p>
        {receipt.header.address.map((a) => <p key={a}>{a}</p>)}
        {receipt.header.phone ? <p>{receipt.header.phone}</p> : null}
        {receipt.header.npwp ? <p>{receipt.header.npwp}</p> : null}
      </header>
      <hr />
      <p style={{ fontWeight: 800 }}>{receipt.title}</p>
      {receipt.meta.map((m) => <p key={m}>{m}</p>)}
      <hr />
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {receipt.lines.map((l, i) => (
          <li key={i} style={{ marginBottom: "1mm" }}>
            <div className="r-row"><span>{l.text}</span><span>{l.amount}</span></div>
            {l.detail.map((d) => <p key={d} style={{ paddingLeft: "3mm" }}>{d}</p>)}
          </li>
        ))}
      </ul>
      <hr />
      {receipt.totals.map((r) => (
        <div key={r.label} className="r-row" style={r.strong ? { fontWeight: 800, fontSize: "1.1em" } : undefined}><span>{r.label}</span><span>{r.value}</span></div>
      ))}
      {receipt.payments.length > 0 ? (
        <>
          <hr />
          {receipt.payments.map((r, i) => <div key={i} className="r-row"><span>{r.label}</span><span>{r.value}</span></div>)}
        </>
      ) : null}
      <hr />
      <p style={{ textAlign: "center" }}>{receipt.footer}</p>
    </article>
  );
}
