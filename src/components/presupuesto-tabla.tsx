"use client";

import { MarcaAdicional } from "@/components/marca-adicional";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { guardar, leer } from "@/lib/recordar";
import { historialPartida, type FilaHistorial } from "@/app/presupuesto/actions";
import { cn, fecha, money, precio, qty } from "@/lib/format";
import { ESTADO_LABEL } from "@/lib/types";
import type { PartidaAvance } from "./presupuesto-obra";

/** Mismas columnas en la cabecera fija y en las filas: descripción, cantidad y monto. */
export const COLUMNAS = "grid grid-cols-[minmax(0,1fr)_4.5rem_6.25rem] gap-x-2";

/** Cabecera de la tabla; va dentro de la barra fija de la página, debajo de los filtros. */
export function EncabezadoTabla() {
  return (
    <div aria-hidden className={cn(COLUMNAS, "px-2.5 pb-1.5 text-[13px] font-medium text-ink-2")}>
      <span>Descripción</span>
      <span className="text-right">
        Cantidad
      </span>
      <span className="text-right">
        Monto
      </span>
    </div>
  );
}

/**
 * Presupuesto de una obra en tabla (Tesorería): por ítem, lo comprado frente a lo presupuestado en
 * cantidad y en monto, agrupado por etapa. Tocar una fila despliega sus órdenes en las mismas columnas.
 */
// La fila desplegada se recuerda: al volver de una orden sigue abierta.
const CLAVE_ABIERTA = "presupuesto-tabla-abierta";
const oyentes = new Set<() => void>();
const leerAbierta = () => leer<number>(CLAVE_ABIERTA);
const suscribir = (l: () => void) => {
  oyentes.add(l);
  return () => oyentes.delete(l);
};

export function PresupuestoTabla({ partidas }: { partidas: PartidaAvance[] }) {
  const abierta = useSyncExternalStore(suscribir, leerAbierta, () => null);
  const alternar = (id: number) => {
    guardar(CLAVE_ABIERTA, abierta === id ? null : id);
    oyentes.forEach((l) => l());
  };
  const etapas = [...new Set(partidas.map((p) => p.etapa))];
  if (partidas.length === 0) return <p className="py-10 text-center text-ink-3">Sin partidas</p>;

  return (
    <div className="flex flex-col gap-3">
      {etapas.map((etapa) => {
        const filas = partidas.filter((p) => p.etapa === etapa);
        const total = filas.reduce((a, p) => a + p.parcial, 0);
        const comprado = filas.reduce((a, p) => a + p.montoComprado, 0);
        return (
          <div key={etapa} className="overflow-hidden rounded-panel bg-surface">
            <h2 className="rotulo border-b border-line bg-sunken/60 px-2.5 py-1.5 text-[19px] font-semibold">{etapa}</h2>
            {filas.map((p) => {
              const abiertaEsta = abierta === p.id;
              const completo = p.comprado >= p.presupuestado - 0.0001 && p.presupuestado > 0;
              const sobrecosto = p.montoComprado > p.parcial + 0.005;
              return (
                <Fragment key={p.id}>
                  <button
                    type="button"
                   
                    onClick={() => alternar(p.id)}
                    aria-expanded={abiertaEsta}
                    aria-label={`${p.descripcion}: comprado ${qty(p.comprado)} de ${qty(p.presupuestado)} ${p.unidad}, S/ ${money(p.montoComprado)} de ${money(p.parcial)}`}
                    className={cn(COLUMNAS, "w-full border-b border-line px-2.5 py-2.5 text-left last:border-0 active:bg-ink/8")}
                  >
                    <span className="flex min-w-0 items-start gap-1 leading-snug hyphens-auto [overflow-wrap:anywhere]">
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className={cn("mt-0.5 shrink-0 text-ink-3 transition-transform", abiertaEsta && "rotate-180")}
                      />
                      <span className="min-w-0">
                        {p.descripcion} <MarcaAdicional requerimiento={p.requerimiento} />
                      </span>
                    </span>
                    <span className="num text-right text-[14px] leading-tight">
                      <span className={cn("block font-semibold", completo && !sobrecosto && "text-ok")}>{qty(p.comprado)}</span>
                      <span className="block text-ink-3">
                        {qty(p.presupuestado)} {p.unidad}
                      </span>
                    </span>
                    <span className="num text-right text-[14px] leading-tight">
                      <span className={cn("block font-semibold", sobrecosto ? "text-danger" : completo && "text-ok")}>{money(p.montoComprado)}</span>
                      <span className="block text-ink-3">{money(p.parcial)}</span>
                    </span>
                  </button>
                  {abiertaEsta && <HistorialFilas partidaId={p.id} unidad={p.unidad} />}
                </Fragment>
              );
            })}
            <Total titulo={`Subtotal ${etapa}`} comprado={comprado} total={total} className="border-t-2 border-line bg-sunken/60" />
          </div>
        );
      })}
      {/* Total de lo filtrado, fijo abajo sobre la barra de navegación (h-16 + borde). */}
      <Total
        titulo={`Total (${partidas.length} ítems)`}
        comprado={partidas.reduce((a, p) => a + p.montoComprado, 0)}
        total={partidas.reduce((a, p) => a + p.parcial, 0)}
        className="sticky bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 rounded-none border-t border-line bg-surface px-[1.625rem] shadow-[0_-6px_12px_-8px_rgb(0_0_0/0.25)]"
      />
    </div>
  );
}

/** Fila de total (subtotal de etapa o total de lo filtrado): comprado sobre presupuestado, en la columna Monto. */
function Total({ titulo, comprado, total, className }: { titulo: string; comprado: number; total: number; className?: string }) {
  return (
    <div className={cn(COLUMNAS, "items-center px-2.5 py-2", className)}>
      <span className="font-semibold">{titulo}</span>
      <span />
      <span className="num text-right text-[14px] leading-tight">
        <span className="block font-semibold">
          <span className="sr-only">Comprado S/ </span>
          {money(comprado)}
        </span>
        <span className="block text-ink-3">
          <span className="sr-only">de S/ </span>
          {money(total)}
        </span>
      </span>
    </div>
  );
}

/** Órdenes de la partida como filas de la misma tabla: orden y proveedor, cantidad × P.U., monto y estado. */
function HistorialFilas({ partidaId, unidad }: { partidaId: number; unidad: string }) {
  const [filas, setFilas] = useState<FilaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    historialPartida(partidaId).then((r) => (r.ok ? setFilas(r.data) : setError(r.error)));
  }, [partidaId]);

  const aviso = error ?? (!filas ? "Cargando…" : filas.length === 0 ? "Sin órdenes" : null);
  if (aviso)
    return (
      <div className="border-b border-line bg-sunken/40 py-2.5 pl-7 pr-2.5">
        <span className={error ? "text-danger" : "text-ink-3"}>
          {aviso}
        </span>
      </div>
    );
  return (
    <>
      {filas!.map((f) => (
        <Link
          key={f.id}
         
          // La vista de pago de Tesorería, la misma que desde Pagos; «Volver» regresa al presupuesto.
          href={`/tesoreria/pago/${f.obra_id}/${encodeURIComponent(f.numero_oc ?? "")}?desde=presupuesto`}
          className={cn(COLUMNAS, "border-b border-line bg-sunken/40 py-2 pl-7 pr-2.5 text-[14px] leading-tight active:bg-ink/8")}
        >
          <span className="min-w-0">
            <span className="rotulo block text-[16px] font-semibold">{f.numero_oc}</span>
            <span className="block text-ink-2 [overflow-wrap:anywhere]">{f.proveedor}</span>
            <span className="num block text-ink-3">
              {fecha(f.fecha)}
              {f.estado ? `, ${ESTADO_LABEL[f.estado]}` : ""}
            </span>
          </span>
          <span className="num text-right">
            <span className="block">{qty(f.cantidad)}</span>
            <span className="block text-ink-3">{unidad}</span>
          </span>
          <span className="num text-right">
            <span className="block">{money(f.parcial)}</span>
            <span className="block text-[13px] text-ink-3">P.U. {precio(f.pu_efectivo)}</span>
          </span>
        </Link>
      ))}
    </>
  );
}
