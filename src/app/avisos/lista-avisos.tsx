"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { cn } from "@/lib/format";
import { borrarAvisos } from "./actions";

export type Aviso = { id: number; titulo: string; cuerpo: string | null; href: string | null; leida_at: string | null; created_at: string };

const LIMA = "America/Lima";
const hora = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LIMA });
const diaLargo = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: LIMA });
/** Día (AAAA-MM-DD) en Lima: los avisos se agrupan por él. */
const diaDe = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LIMA });

/** «Hoy, miércoles, 4 de noviembre de 2026»: siempre con el año; hoy y ayer, con su nombre. */
function tituloDia(dia: string, hoy: string) {
  const fecha = new Date(`${dia}T12:00:00-05:00`);
  const ayer = diaDe(new Date(new Date(`${hoy}T12:00:00-05:00`).getTime() - 864e5));
  const largo = diaLargo.format(fecha);
  const texto = largo.charAt(0).toUpperCase() + largo.slice(1);
  return dia === hoy ? `Hoy, ${largo}` : dia === ayer ? `Ayer, ${largo}` : texto;
}

/** Los avisos (ya del más reciente al más antiguo) por día, en ese orden. */
function porDia(avisos: Aviso[]) {
  const grupos = new Map<string, Aviso[]>();
  for (const a of avisos) {
    const dia = diaDe(new Date(a.created_at));
    grupos.set(dia, [...(grupos.get(dia) ?? []), a]);
  }
  return [...grupos.entries()];
}

/** Lista de avisos; se borran al instante (uno a uno o todos) y el servidor confirma después. */
export function ListaAvisos({ avisos }: { avisos: Aviso[] }) {
  const [visibles, quitar] = useOptimistic(avisos, (actuales, ids: number[] | null) =>
    ids ? actuales.filter((a) => !ids.includes(a.id)) : [],
  );
  const [, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoy] = useState(() => diaDe(new Date()));

  // Si no hay señal, los avisos vuelven a aparecer (el estado optimista se descarta) con el error.
  const borrar = (ids: number[] | null) =>
    startTransition(async () => {
      quitar(ids);
      try {
        setError(await borrarAvisos(ids ?? undefined));
      } catch {
        setError("Sin conexión: no se borraron. Inténtalo de nuevo.");
      }
    });

  return (
    <>
      {visibles.length > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setConfirmar(true)}>
            Limpiar todo
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {porDia(visibles).map(([dia, delDia]) => (
        <section key={dia} aria-label={tituloDia(dia, hoy)} className="flex flex-col gap-1.5">
          <h2 className="px-1 pt-1 text-[15px] font-semibold text-ink-2">{tituloDia(dia, hoy)}</h2>
          <ul className="overflow-hidden rounded-panel bg-surface">
            {delDia.map((a) => (
              <li key={a.id} className="flex border-b border-line last:border-0">
                <Link href={a.href ?? "/avisos"} className="flex min-w-0 flex-1 gap-3 py-3 pl-4 active:bg-ink/8">
                  <span
                    aria-label={a.leida_at ? undefined : "Sin leer"}
                    className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", a.leida_at ? "bg-transparent" : "bg-primary")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block", !a.leida_at && "font-semibold")}>{a.titulo}</span>
                    {a.cuerpo && <span className="block text-ink-2">{a.cuerpo}</span>}
                    <span className="num block text-sm text-ink-3">{hora.format(new Date(a.created_at))}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => borrar([a.id])}
                  aria-label={`Borrar aviso: ${a.titulo}`}
                  className="flex w-12 shrink-0 items-start justify-center pt-3.5 text-ink-3 active:bg-ink/8"
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {visibles.length === 0 && <p className="rounded-panel bg-surface px-4 py-10 text-center text-ink-3">Sin avisos</p>}
      <Confirm
        open={confirmar}
        title="¿Borrar todos los avisos?"
        danger
        onNo={() => setConfirmar(false)}
        onYes={() => {
          setConfirmar(false);
          borrar(null);
        }}
      />
    </>
  );
}
