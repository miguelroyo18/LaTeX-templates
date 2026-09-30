import { useEffect, useState } from "react";
import type { ListSummary } from "../lib/api";
import { ListChecklist } from "./ListChecklist";

interface Props {
  count: number; // compras seleccionadas
  lists: ListSummary[];
  onCreate: (name: string) => Promise<number>;
  onConfirm: (listIds: number[]) => Promise<void>;
  onClose: () => void;
}

/** Elegir a qué listas van las compras seleccionadas en la tabla. */
export function AddToListDialog({ count, lists, onCreate, onConfirm, onClose }: Props) {
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      await onConfirm(picked);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal add-to-list" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Añadir a una lista</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <p className="modal-note">
          {count === 1 ? "1 compra seleccionada." : `${count} compras seleccionadas.`} Marca
          una o varias listas.
        </p>

        <ListChecklist lists={lists} value={picked} onChange={setPicked} onCreate={onCreate} />

        {error && <p className="error">{error}</p>}

        <div className="confirm-actions dialog-foot">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" onClick={confirm} disabled={!picked.length || busy}>
            {busy ? "Añadiendo…" : "Añadir"}
          </button>
        </div>
      </div>
    </div>
  );
}
