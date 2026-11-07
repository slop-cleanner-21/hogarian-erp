"use client";

import { MarcaAdicional } from "@/components/marca-adicional";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { historialPartida, type FilaHistorial } from "@/app/presupuesto/actions";
import { cn, fecha, money, qty } from "@/lib/format";
import { guardar, leer } from "@/lib/recordar";
import { ESTADO_LABEL } from "@/lib/types";
import { EntregasPartida } from "./entregas-partida";
import type { EntregaPartida } from "@/lib/entregas-partida";

export type PartidaAvance = {
  id: number;
  etapa: string;
  requerimiento: string | null;
  descripcion: string;
  unidad: string;
  presupuestado: number;
  pu: number;
  parcial: number;
  comprado: number;
  montoComprado: number;
  llegado: number;
};

type Modo = "cantidad" | "monto";
const CLAVE = "vista-presupuesto";
const oyentes = new Set<() => void>();
const leerModo = (): Modo => leer<Modo>(CLAVE) ?? "cantidad";
const suscribir = (l: () => void) => {
  oyentes.add(l);
  return () => oyentes.delete(l);
};
const elegirModo = (m: Modo) => {
  guardar(CLAVE, m);
  oyentes.forEach((l) => l());
};

const pct = (a: number, b: number) => (b > 0 ? Math.min(100, (a / b) * 100) : 0);

/**
 * Presupuesto de una obra agrupado por etapa: por ítem, lo comprado y lo que llegó frente a lo
 * presupuestado (en cantidad o en monto), y sus órdenes al desplegarlo.
 */
export function PresupuestoObra({
  partidas,
  entregas,
}: {
  partidas: PartidaAvance[];
  /** Lo que llegó de cada partida, entrega por entrega con sus fotos. */
  entregas?: Record<number, EntregaPartida[]>;
}) {
  const modo = useSyncExternalStore(suscribir, leerModo, () => "cantidad" as Modo);
  const [abierta, setAbierta] = useState<number | null>(null);
  const etapas = [...new Set(partidas.map((p) => p.etapa))];

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Ver avance por" className="grid grid-cols-2 gap-1 self-end rounded-control bg-sunken p-1">
        {(["cantidad", "monto"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={modo === m}
            onClick={() => elegirModo(m)}
            className={cn("h-11 rounded-field px-4 text-[15px]", modo === m ? "bg-surface font-semibold" : "text-ink-2")}
          >
            {m === "cantidad" ? "Cantidad" : "Monto"}
          </button>
        ))}
      </div>

      {etapas.map((etapa) => {
        const filas = partidas.filter((p) => p.etapa === etapa);
        const total = filas.reduce((a, p) => a + p.parcial, 0);
        const comprado = filas.reduce((a, p) => a + p.montoComprado, 0);
        return (
          <section key={etapa} aria-label={`Etapa ${etapa}`}>
            <h2 className="flex items-baseline justify-between gap-3 px-1 pb-1.5 pt-2">
              <span className="rotulo text-[21px] font-semibold">{etapa}</span>
              <span className="num text-[15px] text-ink-2">
                {money(comprado)} / {money(total)}
              </span>
            </h2>
            <ul className="overflow-hidden rounded-panel bg-surface">
              {filas.map((p) => {
                const base = modo === "cantidad" ? p.presupuestado : p.parcial;
                const compra = modo === "cantidad" ? p.comprado : p.montoComprado;
                // Lo que llegó se valoriza al precio real de compra (si aún no hay compras, al del presupuesto).
                const precioReal = p.comprado > 0 ? p.montoComprado / p.comprado : p.pu;
                const llego = modo === "cantidad" ? p.llegado : p.llegado * precioReal;
                const fmt = (n: number) => (modo === "cantidad" ? qty(n) : money(n));
                const abiertaEsta = abierta === p.id;
                return (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => setAbierta(abiertaEsta ? null : p.id)}
                      aria-expanded={abiertaEsta}
                      className="block w-full px-4 py-3 text-left active:bg-ink/8"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="leading-snug">
                          {p.descripcion} <MarcaAdicional requerimiento={p.requerimiento} />
                        </span>
                        <span aria-hidden className={cn("flecha-abajo mt-0.5 size-[18px] shrink-0 text-ink-3 transition-transform", abiertaEsta && "rotate-180")} />
                      </div>
                      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/35" style={{ width: `${pct(compra, base)}%` }} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct(llego, base)}%` }} />
                      </div>
                      <div className="num mt-1.5 flex flex-wrap justify-between gap-x-3 text-[14px]">
                        <span className="text-ink-2">
                          Comprado {fmt(compra)} / {fmt(base)} {modo === "cantidad" && <span className="text-ink-3">{p.unidad}</span>}
                        </span>
                        <span className={cn(llego >= base - 0.0001 && base > 0 ? "font-semibold text-ok" : "text-ink-2")}>Llegó {fmt(llego)}</span>
                      </div>
                    </button>
                    {(entregas?.[p.id]?.length ?? 0) > 0 && (
                      <div className="-mt-1 px-4 pb-3">
                        <EntregasPartida entregas={entregas![p.id]} unidad={p.unidad} />
                      </div>
                    )}
                    {abiertaEsta && <OrdenesPartida partidaId={p.id} unidad={p.unidad} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {partidas.length === 0 && <p className="py-10 text-center text-ink-3">Sin partidas</p>}
    </div>
  );
}

/** Órdenes de una partida (historial de compras del ítem en la obra). */
export function OrdenesPartida({
  partidaId,
  unidad,
  antesDe,
}: {
  partidaId: number;
  unidad: string;
  /** Desde el detalle de una orden: solo las anteriores a ella. */
  antesDe?: { numero: string; fecha: string | null };
}) {
  const [filas, setFilas] = useState<FilaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const numero = antesDe?.numero;
  const hasta = antesDe?.fecha ?? null;
  useEffect(() => {
    historialPartida(partidaId, numero ? { numero, fecha: hasta } : undefined).then((r) =>
      r.ok ? setFilas(r.data) : setError(r.error),
    );
  }, [partidaId, numero, hasta]);

  if (error) return <p role="alert" className="px-4 pb-3 text-danger">{error}</p>;
  if (!filas) return <p className="px-4 pb-3 text-ink-3">Cargando…</p>;
  if (filas.length === 0) return <p className="px-4 pb-3 text-ink-3">{numero ? "Sin órdenes anteriores" : "Sin órdenes"}</p>;
  return (
    <ul className="mx-4 mb-3 overflow-hidden rounded-field border border-line">
      {filas.map((f) => (
        <li key={f.id} className="border-b border-line last:border-0">
          <Link
            href={`/consulta/orden/${f.obra_id}/${encodeURIComponent(f.numero_oc ?? "")}`}
            className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2 text-[14px] active:bg-ink/8"
          >
          <span className="rotulo text-[17px] font-semibold">{f.numero_oc}</span>
          <span className="num text-right">{money(f.parcial)}</span>
          <span className="truncate text-ink-2">{f.proveedor}</span>
          <span className="num whitespace-nowrap text-right text-ink-2">
            {qty(f.cantidad)} {unidad} × {money(f.parcial == null ? null : Number(f.parcial) / Number(f.cantidad))}
          </span>
          <span className="num text-ink-3">{fecha(f.fecha)}</span>
          <span className="text-right text-ink-3">{f.estado ? ESTADO_LABEL[f.estado] : ""}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
