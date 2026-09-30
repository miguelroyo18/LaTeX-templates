import { useState } from "react";
import type { ListSummary } from "../lib/api";
import { Check } from "./Check";

interface Props {
  lists: ListSummary[];
  value: number[]; // ids marcados
  onChange: (ids: number[]) => void;
  /** Crea la lista y devuelve su id (el padre recarga `lists`). */
  onCreate: (name: string) => Promise<number>;
}

/** Casillas con todas las listas + un campo para crear una nueva, que queda
 *  marcada al crearla. Si el nombre ya existe, marca esa en vez de fallar. */
export function ListChecklist({ lists, value, onChange, onCreate }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    const same = lists.find(
      (l) => l.name.toLocaleLowerCase("es") === n.toLocaleLowerCase("es"),
    );
    if (same) {
      if (!value.includes(same.id)) onChange([...value, same.id]);
      setName("");
      setError(null);
      return;
    }
    setBusy(true);
    try {
      const id = await onCreate(n);
      onChange([...value, id]);
      setName("");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list-check">
      {lists.length > 0 ? (
        <div className="list-check-items" role="group" aria-label="Listas">
          {lists.map((l) => {
            const on = value.includes(l.id);
            return (
              <button
                type="button"
                key={l.id}
                role="checkbox"
                aria-checked={on}
                className="list-check-row"
                onClick={() => toggle(l.id)}
              >
                <Check on={on} />
                <span className="list-check-name">{l.name}</span>
                <span className="list-check-count">{l.count}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="list-check-empty">Aún no tienes listas. Escribe un nombre para crear la primera.</p>
      )}

      <div className="list-check-new">
        <input
          value={name}
          placeholder="Nueva lista"
          aria-label="Nombre de la nueva lista"
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={create}
          disabled={!name.trim() || busy}
        >
          Crear
        </button>
      </div>
      {error && <p className="list-check-error">{error}</p>}
    </div>
  );
}
