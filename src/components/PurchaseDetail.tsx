import { useEffect } from "react";
import { PurchaseRow, centsToText } from "../lib/api";
import Receipts from "./Receipts";

interface Props {
  purchase: PurchaseRow;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Detail view opened by clicking a row: concept and amount up top, then the
 *  detail notes and the receipts as labelled sections, with edit/delete. */
export default function PurchaseDetail({
  purchase,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head detail-head">
          <h2>Detalle de la compra</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="detail-summary">
          <div className="detail-summary-top">
            <h3 className="detail-concept">{purchase.concept}</h3>
            <span className="detail-amount money">
              {centsToText(purchase.amount_cents)}
            </span>
          </div>
          <span className="detail-date">{fmtDay(purchase.date)}</span>
        </div>

        <section className="detail-block">
          <span className="detail-section">Detalle</span>
          {purchase.detail.trim() ? (
            <p className="detail-text">{purchase.detail}</p>
          ) : (
            <p className="detail-text muted">Sin detalle.</p>
          )}
        </section>

        <section className="detail-block">
          <span className="detail-section">Recibos</span>
          <Receipts purchaseId={purchase.id} />
        </section>

        <footer className="detail-actions">
          <button className="btn-ghost" onClick={onEdit}>
            Editar
          </button>
          <button className="btn-danger" onClick={onDelete}>
            Eliminar
          </button>
        </footer>
      </div>
    </div>
  );
}
