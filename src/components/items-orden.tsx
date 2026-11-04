import { MarcaAdicional } from "@/components/marca-adicional";
import type { ReactNode } from "react";
import type { DisenoItems } from "@/lib/diseno";
import { cn, money, qty, solesPu } from "@/lib/format";

/** Un ítem de una orden, con lo que haga falta para cada diseño (lo que no se tenga queda sin mostrar). */
export type ItemVista = {
  id: number;
  descripcion: string;
  unidad: string;
  etapa: string | null;
  cantidad: number;
  pu: number | null;
  parcial: number;
  /** Precios de referencia: presupuesto, mínimo, máximo y último (o histórico) de otras órdenes. */
  puPresupuesto?: number | null;
  puMin?: number | null;
  puMax?: number | null;
  puUltimo?: number | null;
  /** Partida: ejecutado (comprado en órdenes no anuladas) frente a lo presupuestado, en cantidad y en soles. */
  presupuestado?: number;
  ejecutado?: number;
  montoPresupuestado?: number;
  montoEjecutado?: number;
  /** Sobreprecio sin aprobar. */
  alerta?: boolean;
  comprobante?: string | null;
  /** REGULAR o «ADIC n» (las adicionales llevan su marca). */
  requerimiento?: string | null;
};

const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
const Soles = ({ n, className }: { n: number; className?: string }) => <span className={cn("num", className)}>S/ {money(n)}</span>;
const Cantidad = ({ i }: { i: ItemVista }) => (
  <span className="num">
    {qty(i.cantidad)} <span className="text-ink-3">{i.unidad}</span>
  </span>
);
const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <ul className={cn("overflow-hidden rounded-panel bg-surface", className)}>{children}</ul>
);
const filaClase = (i: ItemVista, extra?: string) => cn("border-b border-line last:border-0", i.alerta && "bg-warn-bg", extra);

/** Una línea: descripción, cantidad y parcial. */
function FilaCompacta({ i }: { i: ItemVista }) {
  return (
    <li className={filaClase(i, "grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 px-4 py-2.5")}>
      <span className="truncate">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
      <span className="text-[14px]">
        <Cantidad i={i} />
      </span>
      <Soles n={i.parcial} className={cn("text-right font-semibold", i.alerta && "text-warn")} />
    </li>
  );
}

function Compacta({ items }: { items: ItemVista[] }) {
  return (
    <Panel>
      {items.map((i) => (
        <FilaCompacta key={i.id} i={i} />
      ))}
    </Panel>
  );
}

const COLS = "grid grid-cols-[minmax(0,1fr)_2.75rem_3.75rem_5.25rem] items-baseline gap-x-2 px-3";
function Tabla({ items }: { items: ItemVista[] }) {
  return (
    <div className="overflow-hidden rounded-panel bg-surface">
      <div aria-hidden className={cn(COLS, "border-b border-line bg-sunken/60 py-2 text-[13px] font-medium text-ink-2")}>
        <span>Descripción</span>
        <span className="text-right">Cant.</span>
        <span className="text-right">P.U.</span>
        <span className="text-right">Parcial</span>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.id} className={filaClase(i, cn(COLS, "py-2 text-[14px]"))}>
            {/* Corta por palabras (con guion si hace falta), no en cualquier letra. */}
            <span lang="es" className="hyphens-auto break-words leading-snug">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
            <span className="num text-right">
              {qty(i.cantidad)}
              <span className="block text-[13px] text-ink-3">{i.unidad}</span>
            </span>
            <span className="num text-right">{solesPu(i.pu)}</span>
            <Soles n={i.parcial} className={cn("text-right font-semibold", i.alerta && "text-warn")} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tarjetas({ items }: { items: ItemVista[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.id} className={cn("flex flex-col gap-1.5 rounded-panel bg-surface px-4 py-3", i.alerta && "bg-warn-bg")}>
          <span className="font-semibold leading-snug">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
          <span className="flex items-end justify-between gap-3">
            <span className="num text-[14px] text-ink-2">
              {qty(i.cantidad)} {i.unidad} × {solesPu(i.pu)}
              {i.etapa && <span className="block text-ink-3">{i.etapa}</span>}
            </span>
            <span className={cn("rotulo shrink-0 text-[24px] font-semibold leading-none", i.alerta && "text-warn")}>S/ {money(i.parcial)}</span>
          </span>
          {i.comprobante && <span className="text-[13px] text-ink-3">Comprobante {i.comprobante}</span>}
        </li>
      ))}
    </ul>
  );
}

function PorEtapa({ items }: { items: ItemVista[] }) {
  const etapas = [...new Set(items.map((i) => i.etapa ?? "Sin etapa"))];
  return (
    <div className="flex flex-col gap-3">
      {etapas.map((e) => {
        const del = items.filter((i) => (i.etapa ?? "Sin etapa") === e);
        return (
          <section key={e} aria-label={`Etapa ${e}`}>
            <h3 className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
              <span className="rotulo text-[19px] font-semibold">
                {e} <span className="num text-[15px] font-normal text-ink-3">{del.length}</span>
              </span>
              <Soles n={del.reduce((a, i) => a + i.parcial, 0)} className="text-[15px] text-ink-2" />
            </h3>
            <Panel>
              {del.map((i) => (
                <FilaCompacta key={i.id} i={i} />
              ))}
            </Panel>
          </section>
        );
      })}
    </div>
  );
}

function ConAvance({ items }: { items: ItemVista[] }) {
  return (
    <Panel>
      {items.map((i) => {
        const base = i.presupuestado ?? 0;
        const hecho = i.ejecutado ?? 0;
        const esta = Math.min(i.cantidad, hecho);
        return (
          <li key={i.id} className={filaClase(i, "flex flex-col gap-1.5 px-4 py-3")}>
            <span className="flex items-start justify-between gap-3">
              <span className="leading-snug">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
              <Soles n={i.parcial} className="shrink-0 font-semibold" />
            </span>
            {base > 0 ? (
              <>
                {/* Ejecutado de la partida (incluye esta orden, en tono fuerte). */}
                <span aria-hidden className="relative block h-2 overflow-hidden rounded-full bg-sunken">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-primary/35" style={{ width: `${pct(hecho, base)}%` }} />
                  <span
                    className="absolute inset-y-0 rounded-full bg-primary"
                    style={{ left: `${pct(hecho - esta, base)}%`, width: `${pct(esta, base)}%` }}
                  />
                </span>
                <span className="num flex flex-wrap justify-between gap-x-3 text-[13px] text-ink-2">
                  {/* Lo que pide esta orden (el tramo fuerte de la barra) y lo ejecutado de la partida. */}
                  <span>
                    Esta orden <span className="font-semibold text-ink">{qty(i.cantidad)}</span> · Ejecutado {qty(hecho)} / {qty(base)} {i.unidad}
                  </span>
                  {i.montoPresupuestado != null && i.montoPresupuestado > 0 && (
                    <span>
                      S/ {money(i.montoEjecutado ?? 0)} / {money(i.montoPresupuestado)}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="text-[13px] text-ink-3">
                <Cantidad i={i} />
              </span>
            )}
          </li>
        );
      })}
    </Panel>
  );
}

function Precios({ items }: { items: ItemVista[] }) {
  return (
    <Panel>
      {items.map((i) => {
        const refs = [
          ["Presupuesto", i.puPresupuesto],
          ["Mín", i.puMin],
          ["Máx", i.puMax],
          ["Último", i.puUltimo],
        ].filter((r): r is [string, number] => r[1] != null);
        const base = i.puPresupuesto ?? i.puUltimo ?? null;
        const dif = i.pu != null && base ? ((i.pu - base) / base) * 100 : null;
        return (
          <li key={i.id} className={filaClase(i, "flex flex-col gap-1.5 px-4 py-3")}>
            <span className="leading-snug">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
            <span className="flex items-baseline justify-between gap-3">
              <span className="num text-[14px] text-ink-2">
                {qty(i.cantidad)} {i.unidad} × <span className="text-[17px] font-semibold text-ink">{solesPu(i.pu)}</span>
                {dif != null && Math.abs(dif) >= 0.05 && (
                  <span className={cn("ml-2 rounded-[5px] px-1 text-[13px]", dif > 0 ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok")}>
                    {dif > 0 ? "+" : ""}
                    {dif.toFixed(1)} %
                  </span>
                )}
              </span>
              <Soles n={i.parcial} className="font-semibold" />
            </span>
            {refs.length > 0 && (
              <span className="num flex flex-wrap gap-1.5 text-[13px]">
                {refs.map(([k, v]) => (
                  <span key={k} className="rounded-[5px] bg-sunken px-1.5 py-0.5 text-ink-2">
                    {k} {solesPu(v)}
                  </span>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </Panel>
  );
}

function PorImporte({ items, total }: { items: ItemVista[]; total: number }) {
  const ordenados = [...items].sort((a, b) => b.parcial - a.parcial);
  return (
    <Panel>
      {ordenados.map((i) => (
        <li key={i.id} className={filaClase(i, "flex flex-col gap-1 px-4 py-2.5")}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
            <Soles n={i.parcial} className="shrink-0 font-semibold" />
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="block h-2 flex-1 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct(i.parcial, total)}%` }} />
            </span>
            <span className="num w-12 shrink-0 text-right text-[13px] text-ink-3">{pct(i.parcial, total).toFixed(1)} %</span>
          </span>
        </li>
      ))}
    </Panel>
  );
}

function Mosaico({ items }: { items: ItemVista[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2">
      {items.map((i) => (
        <li key={i.id} className={cn("flex flex-col gap-1 rounded-panel bg-surface p-3", i.alerta && "bg-warn-bg")}>
          <span className="line-clamp-3 text-[14px] leading-snug">{i.descripcion} <MarcaAdicional requerimiento={i.requerimiento} /></span>
          <span className="mt-auto text-[13px] text-ink-2">
            <Cantidad i={i} />
          </span>
          <span className="rotulo text-[19px] font-semibold leading-tight">S/ {money(i.parcial)}</span>
        </li>
      ))}
    </ul>
  );
}

function Resumen({ items, total }: { items: ItemVista[]; total: number }) {
  const etapas = new Set(items.map((i) => i.etapa).filter(Boolean)).size;
  const mayor = items.reduce<ItemVista | null>((m, i) => (!m || i.parcial > m.parcial ? i : m), null);
  return (
    <div className="flex flex-col gap-2">
      <section aria-label="Resumen de ítems" className="flex flex-col items-center gap-1 rounded-panel bg-surface p-4">
        <span className="text-[14px] text-ink-2">Total de los ítems</span>
        <span className="rotulo text-[32px] font-semibold leading-none">S/ {money(total)}</span>
      </section>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Ítems", String(items.length)],
          ["Etapas", String(etapas)],
          ["Mayor", mayor ? `${pct(mayor.parcial, total).toFixed(0)} %` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-panel bg-surface p-2">
            <div className="text-[13px] text-ink-3">{k}</div>
            <div className="num text-[18px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <Compacta items={items} />
    </div>
  );
}

/** Ítems de una orden en el diseño elegido (salvo «Lista», que cada pantalla pinta a su modo). */
export function ItemsOrden({ diseno, items }: { diseno: Exclude<DisenoItems, "lista">; items: ItemVista[] }) {
  const total = items.reduce((a, i) => a + i.parcial, 0);
  const vista = {
    compacta: <Compacta items={items} />,
    tabla: <Tabla items={items} />,
    tarjetas: <Tarjetas items={items} />,
    etapa: <PorEtapa items={items} />,
    avance: <ConAvance items={items} />,
    precios: <Precios items={items} />,
    importe: <PorImporte items={items} total={total} />,
    mosaico: <Mosaico items={items} />,
    resumen: <Resumen items={items} total={total} />,
  }[diseno];
  return (
    <section aria-label="Ítems de la orden" data-diseno={diseno}>
      {vista}
    </section>
  );
}
