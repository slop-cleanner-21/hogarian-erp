import { MarcaAdicional } from "@/components/marca-adicional";
import { cn, money, qty } from "@/lib/format";
import type { EntregaPartida } from "@/lib/entregas-partida";
import { EntregasPartida } from "./entregas-partida";
import type { Grupo } from "@/lib/presupuesto";

export type FilaSeguimiento = {
  id: number;
  etapa: string;
  descripcion: string;
  /** REGULAR o «ADIC n» (las adicionales llevan su marca). */
  requerimiento?: string | null;
  unidad: string;
  presupuestado: number;
  pu: number | null;
  /** Presupuestado que Operaciones aún no requiere ni Logística compra. */
  porRequerir: number;
  enLogistica: number;
  enTesoreria: number;
  porRecibir: number;
  recibido: number;
  /** Lo requerido por Operaciones que Logística aún no compra. */
  requeridoPendiente: number;
  /** Adelantos: "+20 de L2A" (recibió de una etapa posterior) o "−20 a L1B" (prestó). */
  adelantos: string[];
  /** Lo que llegó, entrega por entrega con sus fotos (vacío si no se muestran). */
  entregas: EntregaPartida[];
  /** Mano de obra: retención acumulada (S/), se paga al cerrar la obra. */
  retencion?: number;
};

type Clave = "porRequerir" | "requeridoPendiente" | "enLogistica" | "enTesoreria" | "porRecibir" | "recibido";

/**
 * Estados del recorrido de lo presupuestado, en orden, con su color en la barra. Suman lo
 * presupuestado. En materiales «llega» (entregado); en subcontratos y mano de obra «se ejecuta».
 */
export function tramosDe(grupo: Grupo): { clave: Clave; label: string; color: string }[] {
  // Prod 1: sin requerimientos ni valorizaciones; la mano de obra se ordena en OS como los subcontratos.
  const materiales = grupo === "MATERIALES";
  return [
    { clave: "porRequerir", label: materiales ? "Por comprar" : "Por contratar", color: "bg-sunken ring-1 ring-inset ring-ink-3" },
    { clave: "enLogistica", label: "Pedido", color: "bg-ink-3/45" },
    { clave: "enTesoreria", label: "Por pagar", color: "bg-warn-line" },
    { clave: "porRecibir", label: materiales ? "Pagado sin entregar" : "Pagado sin ejecutar", color: "bg-primary" },
    { clave: "recibido", label: materiales ? "Entregado" : "Ejecutado", color: "bg-ok" },
  ];
}

/**
 * Seguimiento de un presupuesto por partida, repartido en los estados de `tramosDe`. Sin datos de
 * órdenes, proveedores ni facturas.
 *
 * Cantidades siempre; P.U. solo en mano de obra y subcontratos (pedido de Operaciones).
 */
export function SeguimientoPresupuesto({
  filas,
  grupo,
  ordenEtapas,
}: {
  filas: FilaSeguimiento[];
  grupo: Grupo;
  ordenEtapas: string[];
}) {
  const verPu = grupo !== "MATERIALES";
  const tramos = tramosDe(grupo);
  const etapas = [...new Set(filas.map((f) => f.etapa))].sort(
    (a, b) =>
      (ordenEtapas.indexOf(a) + 1 || 999) -
        (ordenEtapas.indexOf(b) + 1 || 999) || a.localeCompare(b),
  );

  if (filas.length === 0)
    return <p className="py-10 text-center text-ink-3">Sin partidas</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label="Leyenda"
        className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[14px] text-ink-2"
      >
        {tramos.map((t) => (
          <li key={t.clave} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("h-2.5 w-2.5 rounded-full", t.color)}
            />
            {t.label}
          </li>
        ))}
      </ul>
      {etapas.map((etapa) => {
        const lista = filas.filter((f) => f.etapa === etapa);
        return (
          <section key={etapa} aria-label={`Etapa ${etapa}`}>
            <h2 className="flex items-baseline justify-between gap-3 px-1 pb-1.5 pt-2">
              <span className="rotulo text-[21px] font-semibold">{etapa}</span>
            </h2>
            <ul className="overflow-hidden rounded-panel bg-surface">
              {lista.map((f) => (
                <Partida key={f.id} f={f} verPu={verPu} tramos={tramos} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Partida({ f, verPu, tramos }: { f: FilaSeguimiento; verPu: boolean; tramos: ReturnType<typeof tramosDe> }) {
  const pct = (n: number) => (f.presupuestado > 0 ? Math.min(100, (n / f.presupuestado) * 100) : 0);
  // Solo los estados que tiene la partida.
  const estados = tramos.map((t) => ({ label: t.label, valor: f[t.clave], color: t.color })).filter((c) => c.valor > 0.0001);
  return (
    <li className="border-b border-line px-4 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <span className="leading-snug">
          {f.descripcion} <MarcaAdicional requerimiento={f.requerimiento} />
        </span>
        <span className="num shrink-0 whitespace-nowrap text-right">
          {qty(f.presupuestado)} <span className="text-ink-3">{f.unidad}</span>
          {verPu && f.pu != null && <span className="block text-sm text-ink-2">P.U. {money(f.pu)}</span>}
        </span>
      </div>
      {f.adelantos.length > 0 && (
        <div className="num mt-0.5 flex flex-wrap gap-x-3 text-sm">
          {f.adelantos.map((a) => (
            <span key={a} className="font-semibold text-primary">
              {a}
            </span>
          ))}
        </div>
      )}
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-sunken"
        aria-hidden
      >
        {tramos.map((t) => (
          <span
            key={t.clave}
            className={t.color}
            style={{ width: `${pct(f[t.clave])}%` }}
          />
        ))}
      </div>
      <dl className="num mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[14px]">
        {estados.map((c) => (
          <div key={c.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", c.color)} />
            <dt className="text-ink-2">{c.label}</dt>
            <dd className="font-semibold">{qty(c.valor)}</dd>
          </div>
        ))}
      </dl>
      {!!f.retencion && f.retencion > 0 && <p className="num mt-0.5 text-sm text-ink-2">Retención acumulada S/ {money(f.retencion)}</p>}
      {f.entregas.length > 0 && (
        <div className="mt-2">
          <EntregasPartida entregas={f.entregas} unidad={f.unidad} />
        </div>
      )}
    </li>
  );
}
