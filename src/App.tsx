import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ClientSideRowModelModule,
  ModuleRegistry,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";

// AG Grid v32: registra el modelo de filas. Si instalas v33+, usa
// `AllCommunityModule` y quita los dos imports de CSS (v33 usa la Theming API).
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
ModuleRegistry.registerModules([ClientSideRowModelModule]);

import {
  PurchaseRow,
  addPurchase,
  centsToText,
  deletePurchase,
  exportData,
  fileToReceipt,
  importData,
  listConceptColors,
  queryPurchases,
  setConceptColor,
  textToCents,
} from "./lib/api";
import { ReceiptDropzone } from "./components/ReceiptDropzone";
import { ColorPicker } from "./components/ColorPicker";
import { ReceiptViewer } from "./components/ReceiptViewer";
import { DatePicker } from "./components/DatePicker";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditDialog } from "./components/EditDialog";
import { MonthlyView } from "./components/MonthlyView";
import { StatsView } from "./components/StatsView";
import PdfExportDialog from "./components/PdfExportDialog";
import PurchaseDetail from "./components/PurchaseDetail";
import Toast, { type ToastData } from "./components/Toast";
import "./styles.css";

const thisMonth = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'
const today = () => new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

// último día del mes, 'YYYY-MM' -> 'YYYY-MM-DD'
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo, 0).getDate();
  return `${m}-${String(d).padStart(2, "0")}`;
};

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const monthName = (m: number) => {
  const n = MONTHS[m - 1] ?? "";
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const fmtDay = (iso: string) => {
  const [y, mo, d] = iso.split("-");
  return `${d}/${mo}/${y}`;
};

const EditIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const MoonIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

// tema inicial: lo guardado, o si no, la preferencia del sistema
const getInitialDark = () => {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") return true;
    if (saved === "light") return false;
  } catch {
    // sin acceso a localStorage; usamos la preferencia del sistema
  }
  return typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
};

export default function App() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  // se incrementa al añadir/editar/borrar/importar para refrescar Meses y Estadísticas
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);
  const [detailRow, setDetailRow] = useState<PurchaseRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [view, setView] = useState<"detalle" | "meses" | "estadisticas">(
    "detalle",
  );
  const [dark, setDark] = useState<boolean>(getInitialDark);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // sin localStorage: el tema no se recordará, pero funciona igual
    }
  }, [dark]);

  // filtros de la vista
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  // formulario de nueva compra
  const [date, setDate] = useState(today());
  const [concept, setConcept] = useState("");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [color, setColor] = useState(""); // "" = verde por defecto
  const [colorTouched, setColorTouched] = useState(false);
  const [conceptColors, setConceptColors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [addError, setAddError] = useState<string | null>(null);

  // si hay rango (Desde/Hasta), manda el rango; si no, el mes actual
  const load = useCallback(async () => {
    const rangeActive = !!(from || to);
    const searching = !!search.trim();
    let qFrom: string | null;
    let qTo: string | null;
    if (rangeActive) {
      qFrom = from;
      qTo = to;
    } else if (searching) {
      // buscar en todos los años, no solo el mes actual
      qFrom = null;
      qTo = null;
    } else {
      const cur = thisMonth();
      qFrom = `${cur}-01`;
      qTo = monthEnd(cur);
    }
    setRows(await queryPurchases(qFrom, qTo, search.trim() || null));
  }, [from, to, search]);

  // recargar al cambiar cualquier filtro (con pequeño retardo para el buscador)
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const loadColors = useCallback(async () => {
    const list = await listConceptColors();
    const map: Record<string, string> = {};
    for (const c of list) map[c.concept] = c.color;
    setConceptColors(map);
  }, []);

  useEffect(() => {
    loadColors();
  }, [loadColors]);

  // mostrar en el selector el color guardado del concepto, hasta que el usuario elija uno
  useEffect(() => {
    if (colorTouched) return;
    setColor(conceptColors[concept.trim()] ?? "");
  }, [concept, conceptColors, colorTouched]);

  const filtersActive = !!(search || from || to);

  // texto del periodo que se está viendo (junto al título)
  const periodLabel = () => {
    if (!from && !to) {
      if (search.trim()) return "Todos los años";
      const [y, mo] = thisMonth().split("-").map(Number);
      return `${monthName(mo)} ${y}`;
    }
    if (from && to) {
      const fm = from.slice(0, 7);
      if (from === `${fm}-01` && to === monthEnd(fm)) {
        const [y, mo] = fm.split("-").map(Number);
        return `${monthName(mo)} ${y}`;
      }
      if (from === to) return fmtDay(from);
      return `${fmtDay(from)} – ${fmtDay(to)}`;
    }
    if (from) return `Desde ${fmtDay(from)}`;
    return `Hasta ${fmtDay(to!)}`;
  };

  const onAdd = async () => {
    if (!concept.trim()) {
      setAddError("Ponle un concepto a la compra.");
      return;
    }
    let cents = 0;
    if (amount.trim()) {
      const c = textToCents(amount);
      if (c === null) {
        setAddError("El precio no es válido.");
        return;
      }
      cents = c;
    }
    setAddError(null);
    const receipts = await Promise.all(files.map(fileToReceipt));
    await addPurchase(date, concept.trim(), detail.trim(), cents, receipts);
    if (colorTouched) {
      await setConceptColor(concept.trim(), color);
      await loadColors();
    }
    bumpData();
    setConcept("");
    setDetail("");
    setAmount("");
    setColor("");
    setColorTouched(false);
    setFiles([]);

    // mostrar el periodo de la compra recién añadida, sin filtros de búsqueda
    const addedMonth = date.slice(0, 7);
    setSearch("");
    if (addedMonth === thisMonth()) {
      setFrom(null);
      setTo(null);
    } else {
      setFrom(`${addedMonth}-01`);
      setTo(monthEnd(addedMonth));
    }
    setRows(await queryPurchases(`${addedMonth}-01`, monthEnd(addedMonth), null));
  };

  const openReceipts = useCallback((id: number) => setViewing(id), []);
  const askDelete = useCallback((id: number) => setConfirmDelete(id), []);
  const openEdit = useCallback((row: PurchaseRow) => setEditing(row), []);

  const doDelete = async () => {
    if (confirmDelete === null) return;
    await deletePurchase(confirmDelete);
    setConfirmDelete(null);
    await load();
    bumpData();
  };

  const editFromDetail = () => {
    if (!detailRow) return;
    setEditing(detailRow);
    setDetailRow(null);
  };

  const deleteFromDetail = () => {
    if (!detailRow) return;
    setConfirmDelete(detailRow.id);
    setDetailRow(null);
  };

  const showToast = (t: ToastData) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  };

  const onExport = async () => {
    try {
      const path = await exportData();
      showToast({
        kind: "success",
        title: "Copia exportada",
        detail: path,
      });
    } catch (e) {
      showToast({
        kind: "error",
        title: "No se pudo exportar",
        detail: String(e),
      });
    }
  };

  const openImport = () => fileInputRef.current?.click();

  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // permitir volver a elegir el mismo archivo
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImport(String(reader.result));
    reader.onerror = () =>
      showToast({ kind: "error", title: "No se pudo leer el archivo" });
    reader.readAsText(f);
  };

  const doImport = async () => {
    if (!pendingImport) return;
    try {
      const n = await importData(pendingImport);
      await load();
      await loadColors();
      bumpData();
      showToast({
        kind: "success",
        title:
          n === 1 ? "Se ha importado 1 compra" : `Se han importado ${n} compras`,
      });
    } catch (e) {
      showToast({
        kind: "error",
        title: "No se pudo importar",
        detail: String(e),
      });
    }
    setPendingImport(null);
  };

  const columnDefs = useMemo<ColDef<PurchaseRow>[]>(
    () => [
      {
        headerName: "Fecha",
        field: "date",
        width: 130,
        valueFormatter: (p) => (p.value ? fmtDay(p.value) : ""),
      },
      {
        headerName: "Concepto",
        field: "concept",
        flex: 1,
        minWidth: 160,
        cellRenderer: (p: ICellRendererParams<PurchaseRow>) => {
          const c = p.data ? conceptColors[p.data.concept.trim()] : "";
          return (
            <span className="concept-cell">
              <span
                className="concept-dot"
                style={{ background: c || "var(--accent)" }}
              />
              {p.value}
            </span>
          );
        },
      },
      {
        headerName: "Precio",
        field: "amount_cents",
        width: 130,
        cellClass: "money",
        valueFormatter: (p) => (p.value == null ? "" : centsToText(p.value)),
      },
      {
        headerName: "Acumulado",
        field: "running_cents",
        width: 130,
        cellClass: "money accumulated",
        valueFormatter: (p) => (p.value == null ? "" : centsToText(p.value)),
      },
      {
        headerName: "Recibos",
        field: "receipt_count",
        width: 110,
        cellRenderer: (p: ICellRendererParams<PurchaseRow>) =>
          p.data && p.data.receipt_count > 0 ? (
            <button className="link-btn" onClick={() => openReceipts(p.data!.id)}>
              Ver ({p.data.receipt_count})
            </button>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 100,
        cellRenderer: (p: ICellRendererParams<PurchaseRow>) =>
          p.data ? (
            <span className="row-actions">
              <button
                className="icon-btn"
                title="Editar"
                aria-label="Editar"
                onClick={() => openEdit(p.data!)}
              >
                <EditIcon />
              </button>
              <button
                className="icon-btn danger"
                title="Eliminar"
                aria-label="Eliminar"
                onClick={() => askDelete(p.data!.id)}
              >
                <TrashIcon />
              </button>
            </span>
          ) : null,
      },
    ],
    [openReceipts, askDelete, openEdit, conceptColors],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>Mis gastos</h1>
        {view === "detalle" && <span className="period">{periodLabel()}</span>}
        <div className="header-actions">
          <button
            className="btn-ghost"
            onClick={() => setPdfOpen(true)}
            title="Exportar a PDF (un mes o un año)"
          >
            PDF
          </button>
          <button className="btn-ghost" onClick={openImport}>
            Importar
          </button>
          <button className="btn-ghost" onClick={onExport}>
            Exportar
          </button>
          <button
            className="theme-btn"
            onClick={() => setDark((d) => !d)}
            aria-label={dark ? "Modo claro" : "Modo oscuro"}
            title={dark ? "Modo claro" : "Modo oscuro"}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <section className="add-row">
        <DatePicker value={date} onChange={setDate} ariaLabel="Fecha" />
        <input
          className="grow"
          placeholder="Concepto"
          value={concept}
          onChange={(e) => {
            setConcept(e.target.value);
            setColorTouched(false);
            if (addError) setAddError(null);
          }}
          aria-label="Concepto"
        />
        <ColorPicker
          value={color}
          onChange={(c) => {
            setColor(c);
            setColorTouched(true);
          }}
        />
        <input
          className="amount"
          placeholder="0,00 €"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (addError) setAddError(null);
          }}
          inputMode="decimal"
          aria-label="Precio"
        />
        {(concept.trim() !== "" || detail !== "") && (
          <textarea
            className="add-detail"
            placeholder="Detalles"
            value={detail}
            rows={2}
            onChange={(e) => setDetail(e.target.value)}
          />
        )}
        <ReceiptDropzone files={files} onChange={setFiles} />
        <button className="primary" onClick={onAdd}>
          Añadir compra
        </button>
        {addError && <p className="add-error">{addError}</p>}
      </section>

      <div className="tabs">
        <button
          className={`tab ${view === "detalle" ? "active" : ""}`}
          onClick={() => setView("detalle")}
        >
          Detalle
        </button>
        <button
          className={`tab ${view === "meses" ? "active" : ""}`}
          onClick={() => setView("meses")}
        >
          Meses
        </button>
        <button
          className={`tab ${view === "estadisticas" ? "active" : ""}`}
          onClick={() => setView("estadisticas")}
        >
          Estadísticas
        </button>
      </div>

      {view === "meses" && (
        <MonthlyView
          refreshKey={dataVersion}
          onPick={(m) => {
            setSearch("");
            setFrom(`${m}-01`);
            setTo(monthEnd(m));
            setView("detalle");
          }}
        />
      )}

      {view === "estadisticas" && (
        <StatsView colors={conceptColors} refreshKey={dataVersion} />
      )}

      {view === "detalle" && (
        <>
      <section className="filters">
        <input
          className="filter-search"
          placeholder="Buscar concepto o detalle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar concepto"
        />
        <DatePicker
          value={from ?? ""}
          onChange={(v) => setFrom(v || null)}
          placeholder="Desde"
          clearable
          ariaLabel="Desde"
        />
        <DatePicker
          value={to ?? ""}
          onChange={(v) => setTo(v || null)}
          placeholder="Hasta"
          clearable
          ariaLabel="Hasta"
        />
        <button
          className="btn-ghost"
          onClick={() => {
            const t = today();
            setFrom(t);
            setTo(t);
          }}
        >
          Hoy
        </button>
        {filtersActive && (
          <button
            className="btn-ghost"
            onClick={() => {
              setSearch("");
              setFrom(null);
              setTo(null);
            }}
          >
            Limpiar
          </button>
        )}
      </section>

      <div className="ag-theme-quartz grid">
        <AgGridReact<PurchaseRow>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{
            resizable: false,
            suppressMovable: true,
            sortable: false,
            filter: false,
            suppressHeaderMenuButton: true,
          }}
          suppressMovableColumns
          suppressDragLeaveHidesColumns
          suppressCellFocus
          rowClass="clickable-row"
          onRowClicked={(e) => {
            const target = e.event?.target as HTMLElement | null;
            if (target && target.closest("button")) return; // Ver / Editar / Eliminar
            if (e.data) setDetailRow(e.data);
          }}
          getRowId={(p) => String(p.data.id)}
          localeText={{ noRowsToShow: "No hay compras para mostrar" }}
        />
      </div>
        </>
      )}

      {viewing !== null && (
        <ReceiptViewer purchaseId={viewing} onClose={() => setViewing(null)} />
      )}

      {detailRow && (
        <PurchaseDetail
          purchase={detailRow}
          color={conceptColors[detailRow.concept.trim()] ?? ""}
          onEdit={editFromDetail}
          onDelete={deleteFromDetail}
          onClose={() => setDetailRow(null)}
        />
      )}

      {confirmDelete !== null && (
        <ConfirmDialog
          message="¿Eliminar esta compra? También se borrarán sus recibos."
          confirmLabel="Eliminar"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {editing && (
        <EditDialog
          purchase={editing}
          initialColor={conceptColors[editing.concept.trim()] ?? ""}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await load();
            await loadColors();
            bumpData();
          }}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onImportFile}
      />

      {pendingImport && (
        <ConfirmDialog
          message="Importar añadirá las compras del archivo a las que ya tienes. ¿Continuar?"
          confirmLabel="Importar"
          onConfirm={doImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {pdfOpen && (
        <PdfExportDialog
          onClose={() => setPdfOpen(false)}
          showToast={showToast}
        />
      )}

      {toast && <Toast {...toast} />}
    </div>
  );
}
