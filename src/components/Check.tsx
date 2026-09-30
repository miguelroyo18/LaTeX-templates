/** Casilla propia (solo visual). El elemento que la contiene lleva el
 *  role="checkbox" y el aria-checked. `mixed` = algunos marcados. */
export function Check({ on, mixed }: { on: boolean; mixed?: boolean }) {
  return (
    <span className={`check ${on || mixed ? "on" : ""}`} aria-hidden="true">
      {on ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : mixed ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3.5" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ) : null}
    </span>
  );
}
