"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Confirm } from "@/components/ui/confirm";
import { fecha } from "@/lib/format";
import { eliminarBorradorOrden } from "./actions";

export type FilaBorrador = { id: number; obraId: number; obra: string; proveedor: string | null; partidas: number; actualizado: string };

/** Los borradores de Nueva OC / OS de esta cuenta: se retoman tocándolos. */
export function ListaBorradores({ tipo, borradores }: { tipo: string; borradores: FilaBorrador[] }) {
  const router = useRouter();
  const [quitar, setQuitar] = useState<FilaBorrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eliminar = () =>
    startTransition(async () => {
      const r = await eliminarBorradorOrden(quitar!.id);
      setQuitar(null);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <ul aria-label="Borradores" className="overflow-hidden rounded-panel bg-surface">
        {borradores.map((b) => (
          <li key={b.id} className="flex items-center border-b border-line last:border-0">
            <Link href={`/logistica/ordenes/nueva?tipo=${tipo}&obra=${b.obraId}&borrador=${b.id}`} className="min-w-0 flex-1 px-4 py-3 active:bg-ink/8">
              <span className="block truncate font-semibold">{b.obra}</span>
              <span className="block truncate text-ink-2">{b.proveedor ?? "Sin proveedor"}</span>
              <span className="num block text-[14px] text-ink-3">
                {b.partidas} {b.partidas === 1 ? "partida" : "partidas"} · {fecha(b.actualizado)}
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Eliminar borrador de ${b.obra}`}
              onClick={() => setQuitar(b)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
            >
              <Trash2 size={20} />
            </button>
          </li>
        ))}
        {borradores.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin borradores</li>}
      </ul>
      <Confirm open={!!quitar} title="¿Eliminar este borrador?" onYes={eliminar} onNo={() => setQuitar(null)} pending={pending} danger />
    </>
  );
}
