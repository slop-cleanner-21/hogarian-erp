import { cookies } from "next/headers";
import type { Avance, ContextoCompra } from "@/lib/contexto-compra";
import { cn, qty } from "@/lib/format";
import { Plegable } from "./plegable";
import { PlegableRecordado } from "./plegable-recordado";

// Un solo color en tonos: más intenso cuanto más avanzada está la plata (pagado › por pagar › en Logística).
const TRAMOS = [
  { clave: "pagado", label: "Pagado", tono: "bg-avance-1", pastilla: "bg-avance-1 text-avance-1-fg" },
  { clave: "porPagar", label: "Por pagar", tono: "bg-avance-2", pastilla: "bg-avance-2 text-avance-2-fg" },
  { clave: "enLogistica", label: "Logística", tono: "bg-avance-3", pastilla: "bg-avance-3 text-avance-3-fg" },
] as const;
// Cada monto va en una pastilla del color de su tramo de la barra.
const PASTILLA = "inline-block min-w-0 max-w-full rounded-md px-1.5 py-0.5 leading-tight";
const COLUMNAS = "grid grid-cols-4 gap-x-1.5";

// Vista de contexto: montos redondeados a soles.
const soles = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });
const s = (n: number) => soles.format(Math.round(n));

function Encabezado() {
  return (
    <div className={cn(COLUMNAS, "num px-1 text-[13px] text-ink-2")} aria-hidden>
      {TRAMOS.map((t) => (
        <span key={t.clave} className="flex items-center justify-end gap-1 whitespace-nowrap">
          <span className={cn("h-2 w-2 shrink-0 rounded-sm", t.tono)} />
          {t.label}
        </span>
      ))}
      <span className="flex items-center justify-end gap-1 whitespace-nowrap">
        <span className="h-2 w-2 shrink-0 rounded-sm bg-avance-libre ring-1 ring-inset ring-line" />
        Libre
      </span>
    </div>
  );
}

/** Una fila: nombre y presupuesto, la barra y los cuatro montos alineados con el encabezado. */
function Fila({ titulo, detalle, a }: { titulo: string; detalle?: string; a: Avance }) {
  const libre = a.presupuesto - a.pagado - a.porPagar - a.enLogistica;
  const base = Math.max(a.presupuesto, a.pagado + a.porPagar + a.enLogistica, 1);
  return (
    <li
      className="flex flex-col gap-1.5 border-b border-line px-1 py-3 last:border-0"
      aria-label={`${titulo}: presupuesto S/ ${s(a.presupuesto)}, pagado ${s(a.pagado)}, por pagar ${s(a.porPagar)}, en Logística ${s(a.enLogistica)}, ${libre < 0 ? "excedido" : "libre"} ${s(Math.abs(libre))}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-semibold leading-snug">{titulo}</span>
        <span className="num shrink-0">S/ {s(a.presupuesto)}</span>
      </div>
      {detalle && <span className="num -mt-1 text-[14px] text-ink-2">{detalle}</span>}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-avance-libre" aria-hidden>
        {TRAMOS.map((t) => (
          <div key={t.clave} className={t.tono} style={{ width: `${(a[t.clave] / base) * 100}%` }} />
        ))}
      </div>
      <div className={cn(COLUMNAS, "num text-right text-[14px]")} aria-hidden>
        {TRAMOS.map((t) => (
          <span key={t.clave}>
            {a[t.clave] ? <span className={cn(PASTILLA, t.pastilla)}>{s(a[t.clave])}</span> : <span className="px-1.5 text-ink-3">0</span>}
          </span>
        ))}
        <span>
          <span className={cn(PASTILLA, "font-semibold", libre < -0.5 ? "bg-danger-bg text-danger" : "bg-avance-libre text-ink")}>
            {libre < -0.5 ? `−${s(-libre)}` : s(libre)}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * La orden dentro del presupuesto de la obra: obra, etapas que toca y cada una de sus partidas. Arranca
 * plegado y recuerda, por pantalla, si el usuario lo dejó abierto.
 */
export async function ContextoCompraVista({ contexto, pantalla }: { contexto: ContextoCompra; pantalla: "logistica" | "tesoreria" | "consulta" }) {
  const { obra, etapas, items } = contexto;
  const cookie = `prod1_presupuesto_orden_${pantalla}`;
  const abierto = (await cookies()).get(cookie)?.value === "1";
  return (
    <PlegableRecordado cookie={cookie} titulo="Presupuesto" abierto={abierto}>
      <Encabezado />
      <ul>
        <Fila titulo="Obra" a={obra} />
        {etapas.map((e) => (
          <Fila key={e.etapa} titulo={`Etapa ${e.etapa}`} a={e} />
        ))}
      </ul>
      {items.length > 0 && (
        <Plegable titulo={`Ítems de la orden (${items.length})`} className="border border-line">
          <ul>
            {items.map((i) => (
              <Fila
                key={i.partidaId}
                titulo={`${i.descripcion} (${i.etapa})`}
                detalle={`Esta orden: ${qty(i.cantidad)} ${i.unidad} por S/ ${s(i.estaOrden)}`}
                a={i}
              />
            ))}
          </ul>
        </Plegable>
      )}
    </PlegableRecordado>
  );
}
