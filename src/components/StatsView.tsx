import { useEffect, useMemo, useState } from "react";
import {
  PurchaseRow,
  centsToText,
  priceText,
  listMonths,
  queryPurchases,
} from "../lib/api";
import { Select } from "./Select";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const MONTHS_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

function BarRow({
  label,
  value,
  max,
  display,
  color,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  color?: string;
}) {
  const pct = value > 0 && max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="stat-bar">
      <span className="stat-bar-label" title={label}>
        {label}
      </span>
      <span className="stat-bar-track">
        <span
          className="stat-bar-fill"
          style={{ width: `${pct}%`, background: color || undefined }}
        />
      </span>
      <span className="stat-bar-value">{display}</span>
    </div>
  );
}

/** Statistics tab: pick a month or a year and see totals plus bar charts — how
 *  often each concept repeats, spending per concept, and (for a year) spending
 *  per month. */
export function StatsView({
  colors,
  refreshKey,
}: {
  colors: Record<string, string>;
  refreshKey?: number;
}) {
  const [months, setMonths] = useState<string[]>([]);
  const [scope, setScope] = useState<"mes" | "año">("mes");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listMonths()
      .then((ms) => {
        const sorted = [...ms].sort().reverse();
        setMonths(sorted);
        // mantener la selección actual; solo elegir una por defecto la primera vez
        setMonth((prev) => prev || sorted[0] || "");
        setYear((prev) => prev || (sorted[0] ? sorted[0].slice(0, 4) : ""));
      })
      .catch(() => setMonths([]));
  }, [refreshKey]);

  const years = useMemo(
    () => Array.from(new Set(months.map((m) => m.slice(0, 4)))),
    [months],
  );
  const hasData = months.length > 0;

  const period = useMemo(() => {
    if (!hasData) return null;
    if (scope === "mes") {
      return { from: `${month}-01`, to: `${month}-31` };
    }
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }, [scope, month, year, hasData]);

  useEffect(() => {
    if (!period) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    queryPurchases(period.from, period.to, null)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period?.from, period?.to, refreshKey]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.amount_cents, 0);
    const count = rows.length;
    const avg = count ? Math.round(total / count) : 0;

    const byConcept = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      const key = r.concept.trim() || "(sin concepto)";
      const e = byConcept.get(key) ?? { count: 0, sum: 0 };
      e.count++;
      e.sum += r.amount_cents;
      byConcept.set(key, e);
    }
    const concepts = [...byConcept.entries()].map(([concept, v]) => ({
      concept,
      ...v,
    }));

    const byFreq = [...concepts].sort(
      (a, b) => b.count - a.count || b.sum - a.sum,
    );
    const bySpend = [...concepts].sort((a, b) => b.sum - a.sum);

    let byMonth: { label: string; sum: number }[] = [];
    if (scope === "año") {
      const sums = new Array(12).fill(0);
      for (const r of rows) {
        const mo = Number(r.date.slice(5, 7)) - 1;
        if (mo >= 0 && mo < 12) sums[mo] += r.amount_cents;
      }
      byMonth = sums.map((sum, i) => ({ label: MONTHS_SHORT[i], sum }));
    }

    return { total, count, avg, distinct: byConcept.size, byFreq, bySpend, byMonth };
  }, [rows, scope]);

  if (!hasData) {
    return (
      <div className="stats-view">
        <p className="muted">Todavía no hay datos para estadísticas.</p>
      </div>
    );
  }

  const maxFreq = Math.max(1, ...stats.byFreq.map((c) => c.count));
  const maxSpend = Math.max(1, ...stats.bySpend.map((c) => c.sum));
  const maxMonth = Math.max(1, ...stats.byMonth.map((m) => m.sum));

  return (
    <div className="stats-view">
      <div className="stats-controls">
        <div className="tabs">
          <button
            className={`tab ${scope === "mes" ? "active" : ""}`}
            onClick={() => setScope("mes")}
          >
            Mes
          </button>
          <button
            className={`tab ${scope === "año" ? "active" : ""}`}
            onClick={() => setScope("año")}
          >
            Año
          </button>
        </div>
        {scope === "mes" ? (
          <Select
            value={month}
            options={months}
            onChange={setMonth}
            format={monthLabel}
            ariaLabel="Mes"
          />
        ) : (
          <Select
            value={year}
            options={years}
            onChange={setYear}
            ariaLabel="Año"
          />
        )}
      </div>

      <div className="stats-body">
        {loading ? (
          <p className="muted">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No hay compras en este periodo.</p>
        ) : (
          <>
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-num">{centsToText(stats.total)}</span>
                <span className="stat-lbl">Total</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{stats.count}</span>
                <span className="stat-lbl">Compras</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{centsToText(stats.avg)}</span>
                <span className="stat-lbl">Media por compra</span>
              </div>
              <div className="stat-card">
                <span className="stat-num">{stats.distinct}</span>
                <span className="stat-lbl">Conceptos distintos</span>
              </div>
            </div>

            <section className="stat-block">
              <h3 className="stat-title">Conceptos más frecuentes</h3>
              <div className="stat-bars">
                {stats.byFreq.map((c) => (
                  <BarRow
                    key={c.concept}
                    label={c.concept}
                    value={c.count}
                    max={maxFreq}
                    display={`${c.count}×`}
                    color={colors[c.concept]}
                  />
                ))}
              </div>
            </section>

            <section className="stat-block">
              <h3 className="stat-title">Gasto por concepto</h3>
              <div className="stat-bars">
                {stats.bySpend.map((c) => (
                  <BarRow
                    key={c.concept}
                    label={c.concept}
                    value={c.sum}
                    max={maxSpend}
                    display={priceText(c.sum)}
                    color={colors[c.concept]}
                  />
                ))}
              </div>
            </section>

            {scope === "año" && (
              <section className="stat-block">
                <h3 className="stat-title">Gasto por mes</h3>
                <div className="stat-bars">
                  {stats.byMonth.map((m) => (
                    <BarRow
                      key={m.label}
                      label={m.label}
                      value={m.sum}
                      max={maxMonth}
                      display={priceText(m.sum)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
