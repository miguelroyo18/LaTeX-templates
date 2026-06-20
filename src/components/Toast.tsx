export type ToastKind = "success" | "error";

export interface ToastData {
  kind: ToastKind;
  title: string;
  detail?: string;
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function Toast({ kind, title, detail }: ToastData) {
  return (
    <div className={`toast toast-${kind}`} role="status" aria-live="polite">
      <span className="toast-icon">
        {kind === "success" ? <CheckIcon /> : <AlertIcon />}
      </span>
      <div className="toast-body">
        <span className="toast-title">{title}</span>
        {detail && <span className="toast-detail">{detail}</span>}
      </div>
    </div>
  );
}
