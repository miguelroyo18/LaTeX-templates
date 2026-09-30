import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ListSummary } from "../lib/api";
import { ListChecklist } from "./ListChecklist";

const POP_W = 260;

interface Props {
  lists: ListSummary[];
  value: number[];
  onChange: (ids: number[]) => void;
  onCreate: (name: string) => Promise<number>;
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </svg>
  );
}

/** Botón "Listas" que abre las casillas para meter la compra en una o varias
 *  listas. Popover en position:fixed (como el ColorPicker) para que no lo
 *  recorte el scroll de un modal; se abre hacia arriba si abajo no cabe. */
export function ListPicker({ lists, value, onChange, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - POP_W));
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    if (below >= 240 || below >= above) {
      setPos({ top: r.bottom + 6, left, maxHeight: below });
    } else {
      setPos({ bottom: window.innerHeight - r.top + 6, left, maxHeight: above });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!wrapRef.current?.contains(t) || !!popRef.current?.contains(t));
    const onDoc = (e: MouseEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) setOpen(false); // la lista larga del popover sí puede hacer scroll
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const selected = lists.filter((l) => value.includes(l.id));
  const label =
    selected.length === 0
      ? "Listas"
      : selected.length === 1
        ? selected[0].name
        : `${selected.length} listas`;

  return (
    <div className="list-picker" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`list-btn ${selected.length ? "has" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={selected.length ? selected.map((l) => l.name).join(", ") : "Añadir a listas"}
        onClick={() => setOpen((o) => !o)}
      >
        <ListIcon />
        <span className="list-btn-label">{label}</span>
      </button>
      {open && (
        <div
          className="list-pop"
          ref={popRef}
          style={{ position: "fixed", width: POP_W, ...pos }}
        >
          <ListChecklist lists={lists} value={value} onChange={onChange} onCreate={onCreate} />
        </div>
      )}
    </div>
  );
}
