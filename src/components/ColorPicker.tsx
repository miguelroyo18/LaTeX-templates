import { useEffect, useLayoutEffect, useRef, useState } from "react";

// "" = por defecto (verde de acento del tema). El resto son colores fijos que
// se ven bien en claro y oscuro.
const SWATCHES = [
  "",
  "#3b82a6", "#5aa9a0", "#7d9a3c", "#e0a458",
  "#d0894f", "#b5654a", "#c2557a", "#8a6db5", "#6c7bbf",
];

const POP_W = 156; // ancho aprox. del popover (5 columnas)
const POP_H = 76;  // alto aprox. (2 filas)

interface Props {
  value: string;
  onChange: (color: string) => void;
  ariaLabel?: string;
}

export function ColorPicker({ value, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Popover en position:fixed para que no lo recorte el overflow del modal.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let left = r.left;
    if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - 8 - POP_W;
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    if (top + POP_H > window.innerHeight - 8) top = r.top - 6 - POP_H; // gira hacia arriba
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const bg = (c: string) => (c === "" ? "var(--accent)" : c);

  return (
    <div className="color-picker" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="color-btn"
        aria-label={ariaLabel ?? "Color del concepto"}
        title="Color del concepto"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="color-swatch" style={{ background: bg(value) }} />
      </button>
      {open && (
        <div
          className="color-pop"
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
        >
          {SWATCHES.map((c) => (
            <button
              type="button"
              key={c || "default"}
              className={`color-opt ${value === c ? "sel" : ""}`}
              style={{ background: bg(c) }}
              title={c === "" ? "Por defecto" : c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
