import { useEffect, useMemo, useState } from "react";
import { PurchaseRow, priceText, queryPurchases } from "../lib/api";
import { Check } from "./Check";
import { DatePicker } from "./DatePicker";

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

interface Props {
  listName: string;
  inList: Set<number>; // ids que ya están en la lista
  colors: Record<string, string>;
  onConfirm: (ids: number[]) => Promise<void>;
  onClose: () => void;
}

/** Elegir compras existentes (de cualquier mes) para meterlas en una lista.
 *  La selección se mantiene al cambiar la búsqueda, así se pueden juntar
 *  compras de varias búsquedas antes de añadir. */
export function PurchasePickerDialog({ listName, inList, colors, onConfirm, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      queryPurchases(from || null, to || null, search.trim() || null)
        .then((r) => !cancelled && setRows([...r].reverse())) // más recientes primero
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, from, to]);

  const selectable = useMemo(() => rows.filter((r) => !inList.has(r.id)), [rows, inList]);
  const pickedVisible = selectable.filter((r) => picked.has(r.id)).length;
  const allOn = selectable.length > 0 && pickedVisible === selectable.length;

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of selectable) {
        if (allOn) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });

  const confirm = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      await onConfirm([...picked]);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const n = picked.size;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal pick-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Añadir compras a «{listName}»</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="filters pick-filters">
          <input
            className="filter-search"
            placeholder="Buscar concepto o detalle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar compras"
            autoFocus
          />
          <DatePicker value={from} onChange={setFrom} placeholder="Desde" clearable ariaLabel="Desde" />
          <DatePicker value={to} onChange={setTo} placeholder="Hasta" clearable ariaLabel="Hasta" />
        </div>

        <div className="pick-list">
          <button
            type="button"
            role="checkbox"
            aria-checked={allOn ? true : pickedVisible > 0 ? "mixed" : false}
            className="pick-row pick-head"
            onClick={toggleAll}
            disabled={selectable.length === 0}
            title={allOn ? "Desmarcar todas" : "Marcar todas las que se ven"}
          >
            <Check on={allOn} mixed={!allOn && pickedVisible > 0} />
            <span>Fecha</span>
            <span>Concepto</span>
            <span className="r">Importe</span>
          </button>

          {loading ? (
            <p className="pick-empty muted">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="pick-empty muted">
              {search || from || to ? "Ninguna compra coincide con la búsqueda." : "Todavía no hay compras."}
            </p>
          ) : (
            rows.map((r) => {
              const already = inList.has(r.id);
              const on = already || picked.has(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  role="checkbox"
                  aria-checked={on}
                  className={`pick-row ${already ? "is-in" : ""}`}
                  onClick={() => toggle(r.id)}
                  disabled={already}
                  title={already ? "Ya está en la lista" : undefined}
                >
                  <Check on={on} />
                  <span className="pick-date">{fmtDay(r.date)}</span>
                  <span className="pick-concept">
                    <span
                      className="concept-dot"
                      style={{ background: colors[r.concept.trim()] || "var(--accent)" }}
                    />
                    <span className="pick-concept-text">{r.concept}</span>
                    {already && <span className="pick-tag">En la lista</span>}
                  </span>
                  <span className="r money">{priceText(r.amount_cents)}</span>
                </button>
              );
            })
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <footer className="pick-foot">
          <span className="muted">
            {n === 0 ? "Ninguna seleccionada" : n === 1 ? "1 seleccionada" : `${n} seleccionadas`}
          </span>
          <div className="confirm-actions">
            <button className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary" onClick={confirm} disabled={!n || busy}>
              {busy
                ? "Añadiendo…"
                : n <= 1
                  ? "Añadir compra"
                  : `Añadir ${n} compras`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
