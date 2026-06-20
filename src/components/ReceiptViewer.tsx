import { useEffect } from "react";
import Receipts from "./Receipts";

interface Props {
  purchaseId: number;
  onClose: () => void;
}

/** Modal wrapper around the receipts grid (used by the "Ver" link in the grid). */
export function ReceiptViewer({ purchaseId, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Recibos</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <Receipts purchaseId={purchaseId} />
      </div>
    </div>
  );
}
