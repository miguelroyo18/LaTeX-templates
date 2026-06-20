import { useRef, useState } from "react";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
}

/** Zona para soltar recibos (PDF/imagen). Guarda los archivos pendientes de una
 *  nueva compra; el componente padre se los pasa a addPurchase al guardar. */
export function ReceiptDropzone({ files, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const add = (incoming: FileList | null) => {
    if (!incoming) return;
    onChange([...files, ...Array.from(incoming)]);
  };

  const removeAt = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="dropzone-wrap">
      <div
        className={`dropzone ${dragging ? "dropzone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span>Arrastra recibos aquí, o haz clic para elegir</span>
        <small>PDF o imagen, uno o varios</small>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = ""; // permitir volver a elegir el mismo archivo
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="thumbs">
          {files.map((f, i) => (
            <li key={i} className="thumb">
              {f.type.startsWith("image/") ? (
                <img src={URL.createObjectURL(f)} alt={f.name} />
              ) : (
                <span className="thumb-pdf">PDF</span>
              )}
              <span className="thumb-name" title={f.name}>
                {f.name}
              </span>
              <button
                className="thumb-x"
                onClick={() => removeAt(i)}
                aria-label={`Quitar ${f.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
