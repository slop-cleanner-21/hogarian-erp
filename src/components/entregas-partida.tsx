"use client";

import { cn, fecha, qty } from "@/lib/format";
import type { EntregaPartida } from "@/lib/entregas-partida";
import { useVisor, type Foto } from "./visor";

const QUIEN: Record<string, string> = { RESIDENTE: "Residente", LOGISTICA: "Logística", HISTORICO: "Histórico" };

/**
 * Lo que llegó de una partida, entrega por entrega: la foto con su cantidad y fecha (la suma da lo
 * llegado). Tocar una abre el visor con todas las fotos de la partida.
 */
export function EntregasPartida({ entregas, unidad, registro = "Entrega" }: { entregas: EntregaPartida[]; unidad: string; registro?: string }) {
  const visor = useVisor();
  const ordenadas = [...entregas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  // En el visor, cada foto dice a qué entrega pertenece (y cuál de sus fotos es).
  const fotos: Foto[] = ordenadas.flatMap((e) =>
    e.fotos.map((url, i) => ({
      url,
      alt: `${qty(e.cantidad)} ${unidad}`,
      pie: `${registro} de ${qty(e.cantidad)} ${unidad}, ${fecha(e.fecha)}, ${QUIEN[e.rol] ?? e.rol}${e.fotos.length > 1 ? ` (foto ${i + 1} de ${e.fotos.length})` : ""}${e.observacion ? `. Observación: ${e.observacion}` : ""}`,
    })),
  );
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {ordenadas.map((e) => {
        const inicio = fotos.findIndex((f) => f.url === e.fotos[0]);
        const contenido = (
          <>
            {e.fotos[0] && (
              <span className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage */}
                <img src={e.fotos[0]} alt="" loading="lazy" className="h-20 w-24 rounded-t-field object-cover" />
                {e.fotos.length > 1 && (
                  <span className="num absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[13px] font-semibold text-white">
                    {e.fotos.length} fotos
                  </span>
                )}
              </span>
            )}
            <span className="num block px-1.5 pt-1.5 text-left text-[14px] font-semibold leading-tight">
              {qty(e.cantidad)} <span className="font-normal text-ink-3">{unidad}</span>
            </span>
            <span className="num block px-1.5 pb-1 text-left text-[13px] leading-tight text-ink-3">{fecha(e.fecha)}</span>
            {e.observacion && <span className="block px-1.5 pb-1 text-left text-[13px] font-semibold leading-tight text-danger">Observada</span>}
          </>
        );
        return e.fotos.length ? (
          <button
            key={e.id}
            type="button"
            onClick={() => visor.abrir(fotos, Math.max(inicio, 0))}
            aria-label={`Ver fotos: ${qty(e.cantidad)} ${unidad} del ${fecha(e.fecha)}`}
            className={cn("w-24 shrink-0 rounded-field border bg-surface active:opacity-80", e.observacion ? "border-danger" : "border-line")}
          >
            {contenido}
          </button>
        ) : (
          <div key={e.id} className={cn("w-24 shrink-0 rounded-field border bg-surface", e.observacion ? "border-danger" : "border-line")} title={e.observacion ?? undefined}>
            {contenido}
          </div>
        );
      })}
      {visor.elemento}
    </div>
  );
}
