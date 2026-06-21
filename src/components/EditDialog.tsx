import { useEffect, useState } from "react";
import {
  AttachmentMeta,
  PurchaseRow,
  ReceiptInput,
  addAttachments,
  centsToInput,
  deleteAttachment,
  fileToReceipt,
  listAttachmentMeta,
  setConceptColor,
  textToCents,
  updatePurchase,
} from "../lib/api";
import { DatePicker } from "./DatePicker";
import { ColorPicker } from "./ColorPicker";
import { ReceiptDropzone } from "./ReceiptDropzone";

interface Props {
  purchase: PurchaseRow;
  initialColor: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Editar una compra: fecha, concepto, color, precio y sus recibos (quitar los
 *  que hay y añadir nuevos). Los cambios se aplican al guardar; Cancelar los descarta. */
export function EditDialog({ purchase, initialColor, onClose, onSaved }: Props) {
  const [date, setDate] = useState(purchase.date);
  const [concept, setConcept] = useState(purchase.concept);
  const [detail, setDetail] = useState(purchase.detail);
  const [amount, setAmount] = useState(centsToInput(purchase.amount_cents));
  const [color, setColor] = useState(initialColor);

  const [existing, setExisting] = useState<AttachmentMeta[]>([]);
  const [toDelete, setToDelete] = useState<number[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAttachmentMeta(purchase.id).then(setExisting).catch((e) => setError(String(e)));
  }, [purchase.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const removeExisting = (id: number) => {
    setExisting((xs) => xs.filter((a) => a.id !== id));
    setToDelete((d) => [...d, id]);
  };

  const save = async () => {
    if (!concept.trim()) {
      setError("Ponle un concepto.");
      return;
    }
    if (!amount.trim()) {
      setError("Indica un precio.");
      return;
    }
    const cents = textToCents(amount);
    if (cents === null) {
      setError("El precio no es válido.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updatePurchase(purchase.id, date, concept.trim(), detail.trim(), cents);
      await setConceptColor(concept.trim(), color);
      for (const id of toDelete) await deleteAttachment(id);
      if (newFiles.length) {
        const receipts: ReceiptInput[] = await Promise.all(newFiles.map(fileToReceipt));
        await addAttachments(purchase.id, receipts);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal edit" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Editar compra</h2>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="edit-form">
          <label className="edit-field">
            <span>Fecha</span>
            <DatePicker value={date} onChange={setDate} ariaLabel="Fecha" />
          </label>
          <label className="edit-field grow-field">
            <span>Concepto</span>
            <input
              value={concept}
              onChange={(e) => {
                setConcept(e.target.value);
                if (error) setError(null);
              }}
            />
          </label>
          <label className="edit-field">
            <span>Color</span>
            <ColorPicker
              value={color}
              onChange={setColor}
              ariaLabel="Color del concepto"
            />
          </label>
          <label className="edit-field">
            <span>Precio</span>
            <div className="input-eur">
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (error) setError(null);
                }}
              />
              <span className="eur-suffix">€</span>
            </div>
          </label>
        </div>

        <label className="edit-field detail-field">
          <span>Detalle</span>
          <textarea
            className="edit-detail"
            value={detail}
            rows={3}
            placeholder="Notas, garantía, qué incluye…"
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>

        <div className="edit-receipts">
          <span className="edit-sub">Recibos</span>
          {existing.length > 0 && (
            <ul className="rec-list">
              {existing.map((a) => (
                <li key={a.id} className="rec-item">
                  <span className="rec-tag">{a.mime.startsWith("image/") ? "IMG" : "PDF"}</span>
                  <span className="rec-name" title={a.filename}>
                    {a.filename}
                  </span>
                  <button
                    className="rec-x"
                    onClick={() => removeExisting(a.id)}
                    aria-label={`Quitar ${a.filename}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ReceiptDropzone files={newFiles} onChange={setNewFiles} />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="confirm-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
