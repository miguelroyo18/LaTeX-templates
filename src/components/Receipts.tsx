import { useEffect, useState } from "react";
import {
  Attachment,
  attachmentToUrl,
  exportAttachment,
  listAttachments,
} from "../lib/api";
import Toast, { type ToastData } from "./Toast";

type Item = { att: Attachment; url: string };

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Receipts of a purchase: thumbnails that open fullscreen (image or PDF) and
 *  can be downloaded. Meant to be embedded inside a modal/panel. */
export default function Receipts({ purchaseId }: { purchaseId: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null); // fullscreen receipt
  const [saved, setSaved] = useState<ToastData | null>(null); // download notice

  useEffect(() => {
    let urls: string[] = [];
    listAttachments(purchaseId)
      .then((atts) => {
        const mapped = atts.map((att) => {
          const url = attachmentToUrl(att);
          urls.push(url);
          return { att, url };
        });
        setItems(mapped);
      })
      .catch((e) => setError(String(e)));
    return () => urls.forEach(URL.revokeObjectURL); // free memory on close
  }, [purchaseId]);

  const download = async (att: Attachment) => {
    try {
      const path = await exportAttachment(att.id);
      setSaved({ kind: "success", title: "Recibo descargado", detail: path });
    } catch (e) {
      setSaved({
        kind: "error",
        title: "No se pudo descargar",
        detail: String(e),
      });
    }
    setTimeout(() => setSaved(null), 4000);
  };

  if (error)
    return <p className="error">No se pudieron cargar los recibos: {error}</p>;
  if (items.length === 0)
    return <p className="muted">No hay recibos adjuntos.</p>;

  return (
    <>
      <div className="receipt-grid">
        {items.map((it) => (
          <div key={it.att.id} className="receipt-card">
            <button
              className="receipt-open"
              onClick={() => setOpen(it)}
              title="Ver a pantalla completa"
            >
              {it.att.mime.startsWith("image/") ? (
                <img src={it.url} alt={it.att.filename} />
              ) : (
                <span className="receipt-pdf">PDF</span>
              )}
            </button>
            <span className="receipt-name" title={it.att.filename}>
              {it.att.filename}
            </span>
            <button className="receipt-dl" onClick={() => download(it.att)}>
              <DownloadIcon />
              Descargar
            </button>
          </div>
        ))}
      </div>

      {open && (
        <div className="lightbox" onClick={(e) => e.stopPropagation()}>
          <div className="lightbox-bar">
            <span className="lightbox-name" title={open.att.filename}>
              {open.att.filename}
            </span>
            <div className="lightbox-actions">
              <button className="primary lightbox-dl" onClick={() => download(open.att)}>
                <DownloadIcon />
                Descargar
              </button>
              <button
                className="lightbox-x"
                onClick={() => setOpen(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
          </div>
          <div
            className="lightbox-body"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(null);
            }}
          >
            {open.att.mime.startsWith("image/") ? (
              <img src={open.url} alt={open.att.filename} />
            ) : (
              <iframe title={open.att.filename} src={open.url} />
            )}
          </div>
        </div>
      )}

      {saved && <Toast {...saved} />}
    </>
  );
}
