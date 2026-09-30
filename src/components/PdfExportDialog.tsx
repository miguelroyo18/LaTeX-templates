import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  PurchaseRow,
  blobToBase64,
  listMonths,
  priceText,
  queryPurchases,
  saveDownload,
} from "../lib/api";
import { Select } from "./Select";
import type { ToastData } from "./Toast";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

interface Props {
  onClose: () => void;
  showToast: (t: ToastData) => void;
}

/** Generate a PDF report of a single month or a whole year, with a live preview
 *  of its contents. Separate from the JSON backup. */
export default function PdfExportDialog({ onClose, showToast }: Props) {
  const [months, setMonths] = useState<string[]>([]);
  const [scope, setScope] = useState<"mes" | "año">("mes");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMonths()
      .then((ms) => {
        const sorted = [...ms].sort().reverse(); // más reciente primero
        setMonths(sorted);
        if (sorted.length) {
          setMonth(sorted[0]);
          setYear(sorted[0].slice(0, 4));
        }
      })
      .catch(() => setMonths([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const years = useMemo(
    () => Array.from(new Set(months.map((m) => m.slice(0, 4)))),
    [months],
  );
  const hasData = months.length > 0;

  const period = useMemo(() => {
    if (!hasData) return null;
    if (scope === "mes") {
      return {
        from: `${month}-01`,
        to: `${month}-31`,
        label: monthLabel(month),
        code: month,
      };
    }
    return {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: year,
      code: year,
    };
  }, [scope, month, year, hasData]);

  // traer las compras del periodo para la preview (y reusarlas al exportar)
  useEffect(() => {
    if (!period) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoadingRows(true);
    queryPurchases(period.from, period.to, null)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]))
      .finally(() => !cancelled && setLoadingRows(false));
    return () => {
      cancelled = true;
    };
  }, [period?.from, period?.to]);

  const total = useMemo(
    () => rows.reduce((s, r) => s + r.amount_cents, 0),
    [rows],
  );

  const canExport = hasData && !busy && !loadingRows && rows.length > 0;

  const onExport = async () => {
    if (!period || !canExport) return;
    setBusy(true);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Mis gastos", 40, 50);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(110);
      doc.text(period.label, 40, 68);
      doc.setTextColor(0);

      autoTable(doc, {
        startY: 88,
        head: [["Fecha", "Concepto", "Importe"]],
        body: rows.map((r) => [
          fmtDay(r.date),
          r.concept,
          priceText(r.amount_cents),
        ]),
        foot: [
          [
            "",
            { content: "Total", styles: { halign: "right" } },
            { content: priceText(total), styles: { halign: "right" } },
          ],
        ],
        styles: { fontSize: 10, cellPadding: 6 },
        headStyles: { fillColor: [31, 107, 79], textColor: 255 },
        footStyles: {
          fillColor: [238, 238, 234],
          textColor: 20,
          fontStyle: "bold",
        },
        columnStyles: { 2: { halign: "right", cellWidth: 90 } },
        margin: { left: 40, right: 40 },
      });

      const b64 = await blobToBase64(doc.output("blob"));
      const path = await saveDownload(`gastos-${period.code}.pdf`, b64);
      showToast({ kind: "success", title: "PDF exportado", detail: path });
      onClose();
    } catch (e) {
      showToast({
        kind: "error",
        title: "No se pudo exportar el PDF",
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pdf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Exportar a PDF</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        {!hasData ? (
          <p className="muted">Todavía no hay compras para exportar.</p>
        ) : (
          <>
            <div className="pdf-controls">
              <div className="tabs pdf-scope">
                <button
                  className={`tab ${scope === "mes" ? "active" : ""}`}
                  onClick={() => setScope("mes")}
                >
                  Mes
                </button>
                <button
                  className={`tab ${scope === "año" ? "active" : ""}`}
                  onClick={() => setScope("año")}
                >
                  Año
                </button>
              </div>

              {scope === "mes" ? (
                <Select
                  value={month}
                  options={months}
                  onChange={setMonth}
                  format={monthLabel}
                  ariaLabel="Mes a exportar"
                />
              ) : (
                <Select
                  value={year}
                  options={years}
                  onChange={setYear}
                  ariaLabel="Año a exportar"
                />
              )}
            </div>

            <div className="pdf-preview">
              <div className="pdf-page">
                <div className="pdf-page-title">Mis gastos</div>
                <div className="pdf-page-period">{period?.label}</div>
                {loadingRows ? (
                  <p className="muted">Cargando…</p>
                ) : rows.length === 0 ? (
                  <p className="muted">No hay compras en este periodo.</p>
                ) : (
                  <table className="pdf-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th className="r">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{fmtDay(r.date)}</td>
                          <td>{r.concept}</td>
                          <td className="r money">
                            {priceText(r.amount_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td></td>
                        <td className="r">Total</td>
                        <td className="r money">{priceText(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>

            <footer className="pdf-actions">
              <button className="btn-ghost" onClick={onClose}>
                Cancelar
              </button>
              <button className="primary" onClick={onExport} disabled={!canExport}>
                {busy ? "Generando…" : "Exportar PDF"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
