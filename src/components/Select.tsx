import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  format?: (v: string) => string; // etiqueta a mostrar
  ariaLabel?: string;
}

/** Desplegable propio: el botón y la lista los pintamos nosotros, así el diseño
 *  no depende del navegador (a diferencia de un <select> nativo). */
export function Select({ value, options, onChange, format, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const label = (v: string) => (format ? format(v) : v);

  return (
    <div className="ui-select" ref={ref}>
      <button
        type="button"
        className="ui-select-btn"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label(value)}</span>
        <svg className="ui-caret" width="12" height="12" viewBox="0 0 12 12">
          <path
            d="M2 4.5l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul className="ui-select-list" role="listbox">
          {options.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={`ui-select-opt ${o === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
            >
              {label(o)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
