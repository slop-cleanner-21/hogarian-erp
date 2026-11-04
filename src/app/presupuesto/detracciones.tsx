"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { guardarDetracciones } from "./actions";

export type ItemObra = { itemId: number; descripcion: string };
const POR_DEFECTO = "5";

/**
 * Ítems de la obra que llevan detracción, con su porcentaje (5 % al agregarlos). Al registrar una factura
 * se calcula la detracción con estas líneas y Tesorería paga al proveedor el resto.
 */
export function DetraccionesObra({ obraId, items, guardadas }: { obraId: number; items: ItemObra[]; guardadas: Record<number, number> }) {
  const router = useRouter();
  // Lo que se ve: ítem → porcentaje (texto del campo). Se compara con lo guardado para saber qué cambió.
  const [valores, setValores] = useState<Record<number, string>>(() =>
    Object.fromEntries(Object.entries(guardadas).map(([id, p]) => [id, String(p)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nombre = new Map(items.map((i) => [i.itemId, i.descripcion]));
  const marcados = Object.keys(valores)
    .map(Number)
    .sort((a, b) => (nombre.get(a) ?? "").localeCompare(nombre.get(b) ?? ""));
  const cambios = [
    ...marcados.filter((id) => Number(valores[id]) !== guardadas[id]).map((id) => ({ item_id: id, porcentaje: Number(valores[id]) })),
    ...Object.keys(guardadas)
      .map(Number)
      .filter((id) => !(id in valores))
      .map((id) => ({ item_id: id, porcentaje: null })),
  ];
  const validos = marcados.every((id) => Number(valores[id]) > 0 && Number(valores[id]) < 100);

  const editar = (cambio: (v: Record<number, string>) => Record<number, string>) => {
    setError(null);
    setValores(cambio);
  };
  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarDetracciones(obraId, cambios);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <section aria-label="Detracciones" className="flex flex-col gap-2 rounded-panel bg-surface p-3">
      <h2 className="rotulo px-1 text-[17px] font-semibold">Detracción</h2>
      {marcados.length > 0 && (
        <ul>
          {marcados.map((id) => (
            <li key={id} className="flex items-center gap-2 border-b border-line py-1.5 pl-1 last:border-0">
              <span className="min-w-0 flex-1 leading-snug">{nombre.get(id)}</span>
              <span className="flex w-24 shrink-0 items-center gap-1.5">
                <NumberInput
                  value={valores[id]}
                  onChange={(e) => editar((v) => ({ ...v, [id]: e.target.value }))}
                  aria-label={`Detracción de ${nombre.get(id)}`}
                />
                <span className="text-ink-2">%</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  editar((v) => {
                    const resto = { ...v };
                    delete resto[id];
                    return resto;
                  })
                }
                aria-label={`Quitar la detracción de ${nombre.get(id)}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
              >
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SearchSelect
        label="Agregar ítem con detracción"
        placeholder="Agregar ítem"
        value={null}
        onChange={(v) => editar((x) => ({ ...x, [Number(v)]: POR_DEFECTO }))}
        options={items.filter((i) => !(i.itemId in valores)).map((i) => ({ value: String(i.itemId), label: i.descripcion }))}
      />
      {error && (
        <p role="alert" className="px-1 text-danger">
          {error}
        </p>
      )}
      {cambios.length > 0 && (
        <Button onClick={guardar} disabled={pending || !validos}>
          Guardar detracciones
        </Button>
      )}
    </section>
  );
}
