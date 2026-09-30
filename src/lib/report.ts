import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { PurchaseRow, blobToBase64, centsToInput, priceText } from "./api";

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

/** "Reforma cocina" -> "reforma-cocina", safe for a file name. */
export const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lista";

/** "3 compras, del 05/01/2026 al 10/02/2026" — rows must be sorted by date. */
export const rangeLabel = (rows: PurchaseRow[]) => {
  if (rows.length === 0) return "Sin compras";
  const n = rows.length === 1 ? "1 compra" : `${rows.length} compras`;
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  if (first === last) return `${n}, del ${fmtDay(first)}`;
  return `${n}, del ${fmtDay(first)} al ${fmtDay(last)}`;
};

/** PDF with the same look as the monthly report. Adds a "Detalle" column only
 *  when some purchase has one. Returns the file as base64. */
export async function purchasesPdf(
  title: string,
  subtitle: string,
  rows: PurchaseRow[],
): Promise<string> {
  const withDetail = rows.some((r) => r.detail.trim() !== "");
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  const amountCol = withDetail ? 3 : 2;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(110);
  doc.text(subtitle, 40, 68);
  doc.setTextColor(0);

  const totalLabel = { content: "Total", styles: { halign: "right" as const } };
  const totalValue = { content: priceText(total), styles: { halign: "right" as const } };

  autoTable(doc, {
    startY: 88,
    head: [
      withDetail
        ? ["Fecha", "Concepto", "Detalle", "Importe"]
        : ["Fecha", "Concepto", "Importe"],
    ],
    body: rows.map((r) =>
      withDetail
        ? [fmtDay(r.date), r.concept, r.detail, priceText(r.amount_cents)]
        : [fmtDay(r.date), r.concept, priceText(r.amount_cents)],
    ),
    foot: [withDetail ? ["", "", totalLabel, totalValue] : ["", totalLabel, totalValue]],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [31, 107, 79], textColor: 255 },
    footStyles: { fillColor: [238, 238, 234], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 70 },
      ...(withDetail ? { 2: { fontSize: 9, textColor: 90 } } : {}),
      [amountCol]: { halign: "right", cellWidth: 90 },
    },
    margin: { left: 40, right: 40 },
  });

  return blobToBase64(doc.output("blob"));
}

/** CSV that opens cleanly in Spanish-locale Excel / LibreOffice / Numbers:
 *  semicolon separator, decimal comma, UTF-8 with BOM. Returns base64. */
export function purchasesCsv(rows: PurchaseRow[]): Promise<string> {
  const cell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    ["Fecha", "Concepto", "Detalle", "Importe (EUR)"].join(";"),
    ...rows.map((r) =>
      [fmtDay(r.date), cell(r.concept), cell(r.detail), r.amount_cents ? centsToInput(r.amount_cents) : ""].join(";"),
    ),
  ];
  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  return blobToBase64(new Blob([csv], { type: "text/csv;charset=utf-8" }));
}
