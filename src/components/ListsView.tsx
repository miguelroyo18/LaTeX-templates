import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import {
  ListSummary,
  PurchaseRow,
  addToList,
  deleteList,
  priceText,
  purchasesInList,
  removeFromList,
  renameList,
  saveDownload,
} from "../lib/api";
import { purchasesCsv, purchasesPdf, rangeLabel, slug } from "../lib/report";
import { ConfirmDialog } from "./ConfirmDialog";
import { PurchasePickerDialog } from "./PurchasePickerDialog";
import type { ToastData } from "./Toast";

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
const compras = (n: number) => (n === 1 ? "1 compra" : `${n} compras`);

function RemoveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface Props {
  lists: ListSummary[];
  colors: Record<string, string>;
  refreshKey: number;
  onCreate: (name: string) => Promise<number>;
  /** Algo cambió en las listas: el padre recarga listas y vistas. */
  onChanged: () => void;
  onOpenPurchase: (row: PurchaseRow) => void;
  showToast: (t: ToastData) => void;
}

/** Pestaña Listas: a la izquierda las listas (y crear una nueva); a la derecha
 *  las compras de la elegida, con añadir, quitar, renombrar, borrar y exportar. */
export function ListsView({
  lists,
  colors,
  refreshKey,
  onCreate,
  onChanged,
  onOpenPurchase,
  showToast,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const skipBlurSave = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selected = lists.find((l) => l.id === selectedId) ?? null;

  // elegir la primera lista si no hay ninguna elegida (o si se borró la elegida)
  useEffect(() => {
    if (!lists.length) setSelectedId(null);
    else if (!lists.some((l) => l.id === selectedId)) setSelectedId(lists[0].id);
  }, [lists, selectedId]);

  useEffect(() => {
    setRenaming(null);
    setRenameError(null);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === null) {
      setRows([]);
      return;
    }
    let cancelled = false;
    purchasesInList(selectedId)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  const create = async () => {
    const n = newName.trim();
    if (!n) return;
    try {
      const id = await onCreate(n);
      setSelectedId(id);
      setNewName("");
      setCreateError(null);
    } catch (e) {
      setCreateError(String(e));
    }
  };

  const saveRename = async () => {
    if (renaming === null || !selected) return;
    const n = renaming.trim();
    if (!n || n === selected.name) {
      setRenaming(null);
      setRenameError(null);
      return;
    }
    try {
      await renameList(selected.id, n);
      setRenaming(null);
      setRenameError(null);
      onChanged();
    } catch (e) {
      setRenameError(String(e));
    }
  };

  const doDelete = async () => {
    if (!selected) return;
    const name = selected.name;
    setConfirmDelete(false);
    try {
      await deleteList(selected.id);
      setSelectedId(null);
      onChanged();
      showToast({ kind: "success", title: `Lista «${name}» eliminada` });
    } catch (e) {
      showToast({ kind: "error", title: "No se pudo eliminar la lista", detail: String(e) });
    }
  };

  const remove = useCallback(
    async (purchaseId: number) => {
      if (selectedId === null) return;
      try {
        await removeFromList(selectedId, [purchaseId]);
        onChanged();
      } catch (e) {
        showToast({ kind: "error", title: "No se pudo quitar de la lista", detail: String(e) });
      }
    },
    [selectedId, onChanged, showToast],
  );

  const addPicked = async (ids: number[]) => {
    if (!selected) return;
    const n = await addToList(selected.id, ids);
    setPicking(false);
    onChanged();
    showToast({
      kind: "success",
      title: n === 1 ? `1 compra añadida a «${selected.name}»` : `${n} compras añadidas a «${selected.name}»`,
    });
  };

  const exportAs = async (kind: "pdf" | "csv") => {
    if (!selected || !rows.length || exporting) return;
    setExporting(true);
    try {
      const b64 =
        kind === "pdf"
          ? await purchasesPdf(selected.name, rangeLabel(rows), rows)
          : await purchasesCsv(rows);
      const path = await saveDownload(`lista-${slug(selected.name)}.${kind}`, b64);
      showToast({
        kind: "success",
        title: kind === "pdf" ? "PDF exportado" : "CSV exportado",
        detail: path,
      });
    } catch (e) {
      showToast({ kind: "error", title: "No se pudo exportar la lista", detail: String(e) });
    } finally {
      setExporting(false);
    }
  };

  const inList = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);

  const columnDefs = useMemo<ColDef<PurchaseRow>[]>(
    () => [
      {
        headerName: "Fecha",
        field: "date",
        width: 120,
        valueFormatter: (p) => (p.value ? fmtDay(p.value) : ""),
      },
      {
        headerName: "Concepto",
        field: "concept",
        flex: 1,
        minWidth: 160,
        cellRenderer: (p: ICellRendererParams<PurchaseRow>) => (
          <span className="concept-cell">
            <span
              className="concept-dot"
              style={{ background: (p.data && colors[p.data.concept.trim()]) || "var(--accent)" }}
            />
            {p.value}
          </span>
        ),
      },
      {
        headerName: "Precio",
        field: "amount_cents",
        width: 120,
        cellClass: "money",
        valueFormatter: (p) => (p.value == null ? "" : priceText(p.value)),
      },
      {
        headerName: "Acumulado",
        field: "running_cents",
        width: 130,
        cellClass: "money accumulated",
        valueFormatter: (p) => (p.value == null ? "" : priceText(p.value)),
      },
      {
        headerName: "",
        colId: "remove",
        width: 64,
        cellRenderer: (p: ICellRendererParams<PurchaseRow>) =>
          p.data ? (
            <span className="row-actions">
              <button
                className="icon-btn danger"
                title="Quitar de la lista (la compra no se borra)"
                aria-label="Quitar de la lista"
                onClick={() => remove(p.data!.id)}
              >
                <RemoveIcon />
              </button>
            </span>
          ) : null,
      },
    ],
    [colors, remove],
  );

  return (
    <div className="lists-view">
      <aside className="lists-side">
        <div className="lists-new">
          <input
            placeholder="Nueva lista"
            value={newName}
            aria-label="Nombre de la nueva lista"
            onChange={(e) => {
              setNewName(e.target.value);
              if (createError) setCreateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button className="btn-ghost" onClick={create} disabled={!newName.trim()}>
            Crear
          </button>
        </div>
        {createError && <p className="list-check-error">{createError}</p>}

        <nav className="lists-nav" aria-label="Listas">
          {lists.map((l) => (
            <button
              key={l.id}
              className={`list-item ${l.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(l.id)}
              aria-current={l.id === selectedId ? "true" : undefined}
            >
              <span className="list-item-name">{l.name}</span>
              <span className="list-item-meta">
                <span>{compras(l.count)}</span>
                <span className="list-item-total">{priceText(l.total_cents)}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="list-main">
        {!selected ? (
          <div className="list-empty">
            <h2>Agrupa compras en listas</h2>
            <p>Crea tu primera lista a la izquierda.</p>
          </div>
        ) : (
          <>
            <header className="list-head">
              <div className="list-title">
                {renaming !== null ? (
                  <input
                    className="list-rename"
                    value={renaming}
                    autoFocus
                    aria-label="Nuevo nombre de la lista"
                    onChange={(e) => {
                      setRenaming(e.target.value);
                      if (renameError) setRenameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur(); // guarda en onBlur
                      if (e.key === "Escape") {
                        skipBlurSave.current = true;
                        setRenaming(null);
                        setRenameError(null);
                      }
                    }}
                    onBlur={() => {
                      if (skipBlurSave.current) {
                        skipBlurSave.current = false;
                        return;
                      }
                      saveRename();
                    }}
                  />
                ) : (
                  <h2 title="Doble clic para renombrar" onDoubleClick={() => setRenaming(selected.name)}>
                    {selected.name}
                  </h2>
                )}
                <span className="list-sub">{compras(selected.count)}</span>
                {renameError && <span className="list-check-error">{renameError}</span>}
              </div>
              <span className="list-total">{priceText(selected.total_cents)}</span>
            </header>

            <div className="list-actions">
              <button className="primary" onClick={() => setPicking(true)}>
                Añadir compras
              </button>
              <button
                className="btn-ghost"
                onClick={() => exportAs("pdf")}
                disabled={!rows.length || exporting}
              >
                Exportar PDF
              </button>
              <button
                className="btn-ghost"
                onClick={() => exportAs("csv")}
                disabled={!rows.length || exporting}
              >
                Exportar CSV
              </button>
              <span className="list-actions-gap" />
              <button className="btn-ghost" onClick={() => setRenaming(selected.name)}>
                Renombrar
              </button>
              <button className="btn-ghost danger" onClick={() => setConfirmDelete(true)}>
                Eliminar lista
              </button>
            </div>

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
                  if (target && target.closest("button")) return; // Quitar
                  if (e.data) onOpenPurchase(e.data);
                }}
                getRowId={(p) => String(p.data.id)}
                localeText={{
                  noRowsToShow: "Esta lista está vacía. Usa «Añadir compras» para llenarla.",
                }}
              />
            </div>
          </>
        )}
      </section>

      {confirmDelete && selected && (
        <ConfirmDialog
          message={`¿Eliminar la lista «${selected.name}»? Las compras no se borran, solo la lista.`}
          confirmLabel="Eliminar lista"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
          danger
        />
      )}

      {picking && selected && (
        <PurchasePickerDialog
          listName={selected.name}
          inList={inList}
          colors={colors}
          onConfirm={addPicked}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
