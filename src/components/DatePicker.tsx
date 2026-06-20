import { useEffect, useRef, useState } from "react";

interface Props {
  value: string; // 'YYYY-MM-DD' o '' (vacío)
  onChange: (v: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  clearable?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
};

const WD = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Calendario propio. Admite valor vacío (muestra el placeholder) y, si es
 *  clearable, una × para quitar la fecha. */
export function DatePicker({ value, onChange, ariaLabel, placeholder, clearable }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const has = value !== "";
  const sel = has ? parse(value) : null;
  const t = new Date();
  const baseY = sel ? sel.y : t.getFullYear();
  const baseM = sel ? sel.m : t.getMonth();
  const [view, setView] = useState({ y: baseY, m: baseM });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const display = has ? `${pad(sel!.d)}/${pad(sel!.m + 1)}/${sel!.y}` : placeholder ?? "";

  const startWd = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // 0 = lunes
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prev = () =>
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () =>
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  const pick = (d: number) => {
    onChange(toISO(view.y, view.m, d));
    setOpen(false);
  };

  const isSelected = (d: number) =>
    has && view.y === sel!.y && view.m === sel!.m && d === sel!.d;
  const isToday = (d: number) =>
    view.y === t.getFullYear() && view.m === t.getMonth() && d === t.getDate();

  return (
    <div className="ui-date" ref={ref}>
      <button
        type="button"
        className={`ui-date-btn ${has ? "" : "is-empty"}`}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open) setView({ y: baseY, m: baseM });
          setOpen((o) => !o);
        }}
      >
        <span>{display}</span>
        {has && clearable && (
          <span
            className="ui-date-clear"
            role="button"
            aria-label="Quitar fecha"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            ×
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" />
          <path d="M1.5 5.5h11M4.5 1v2.5M9.5 1v2.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="ui-cal">
          <div className="ui-cal-head">
            <button type="button" className="ui-cal-nav" onClick={prev} aria-label="Mes anterior">
              ‹
            </button>
            <span className="ui-cal-title">
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" className="ui-cal-nav" onClick={next} aria-label="Mes siguiente">
              ›
            </button>
          </div>

          <div className="ui-cal-grid ui-cal-wd">
            {WD.map((w) => (
              <span key={w} className="ui-cal-wdcell">{w}</span>
            ))}
          </div>

          <div className="ui-cal-grid">
            {cells.map((d, i) =>
              d === null ? (
                <span key={i} className="ui-cal-empty" />
              ) : (
                <button
                  type="button"
                  key={i}
                  className={`ui-cal-day ${isSelected(d) ? "is-selected" : ""} ${
                    isToday(d) ? "is-today" : ""
                  }`}
                  onClick={() => pick(d)}
                >
                  {d}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
