import { useEffect, useMemo, useState } from "react";
import { MonthSummary, centsToText, monthlySummary } from "../lib/api";

interface Props {
  onPick: (month: string) => void;
  refreshKey?: number;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// 'YYYY-MM' -> 'Junio'
const monthName = (m: string) => {
  const mo = Number(m.slice(5, 7));
  const name = MONTHS[mo - 1] ?? m;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

export function MonthlyView({ onPick, refreshKey }: Props) {
  const [items, setItems] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<string | null>(null);

  useEffect(() => {
    monthlySummary()
      .then((data) => {
        setItems(data);
        const ys = [...new Set(data.map((d) => d.month.slice(0, 4)))].sort().reverse();
        setYear((prev) => prev ?? ys[0] ?? null);
      })
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const years = useMemo(
    () => [...new Set(items.map((i) => i.month.slice(0, 4)))].sort().reverse(),
    [items],
  );

  const monthsOfYear = useMemo(
    () =>
      items
        .filter((i) => i.month.slice(0, 4) === year)
        .sort((a, b) => a.month.localeCompare(b.month)),
    [items, year],
  );

  if (loading) return <p className="muted">Cargando…</p>;
  if (!items.length) return <p className="muted">No hay compras todavía.</p>;

  return (
    <div className="months-view">
      <div className="year-bar">
        {years.map((y) => (
          <button
            key={y}
            className={`year-chip ${y === year ? "active" : ""}`}
            onClick={() => setYear(y)}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="months">
        {monthsOfYear.map((it) => (
          <button key={it.month} className="month-card" onClick={() => onPick(it.month)}>
            <span className="month-name">{monthName(it.month)}</span>
            <span className="month-count">
              {it.count} {it.count === 1 ? "compra" : "compras"}
            </span>
            <span className="month-amount">{centsToText(it.total_cents)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
