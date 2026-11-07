import "server-only";
import { todas } from "@/lib/paginar";
import { createClient } from "@/lib/supabase/server";

/** Montos de un ámbito (obra, etapa o ítem) frente a su presupuesto. */
export type Avance = {
  presupuesto: number;
  /** Órdenes pagadas (pagadas, en entrega o recibidas). */
  pagado: number;
  /** En Tesorería, por pagar. */
  porPagar: number;
  /** Órdenes aún en Logística (cotizando, con precios, facturadas). */
  enLogistica: number;
};
export type ContextoCompra = {
  obra: Avance;
  /** Etapas que toca la orden. */
  etapas: (Avance & { etapa: string })[];
  /** Partidas de la orden, con lo que pide esta orden. */
  items: (Avance & { partidaId: number; etapa: string; descripcion: string; unidad: string; cantidad: number; estaOrden: number })[];
};

const PAGADO = new Set(["PAGADA", "EN_ENTREGA", "RECIBIDA"]);
const vacio = (): Avance => ({ presupuesto: 0, pagado: 0, porPagar: 0, enLogistica: 0 });

/**
 * Contexto de una orden dentro del presupuesto de su obra: cuánto está pagado, por pagar y en Logística
 * frente a lo presupuestado, para toda la obra, para las etapas de la orden y para cada una de sus partidas.
 */
export async function contextoCompra(obraId: number, numero: string): Promise<ContextoCompra> {
  const supabase = await createClient();
  const [partidas, lineas] = await Promise.all([
    todas((a, b) =>
      supabase.from("v_avance_partida").select("partida_id, etapa, descripcion, unidad, presupuestado, parcial").eq("obra_id", obraId).range(a, b),
    ),
    todas((a, b) =>
      supabase.from("v_oc_items_calc").select("partida_id, numero_oc, parcial, cantidad, estado, retenido, retenida_en").eq("obra_id", obraId).neq("estado", "ANULADA").range(a, b),
    ),
  ]);

  const porPartida = new Map<number, Avance>();
  for (const p of partidas) porPartida.set(p.partida_id!, { ...vacio(), presupuesto: Number(p.parcial ?? 0) });
  const estaOrden = new Map<number, { monto: number; cantidad: number }>();
  for (const l of lineas) {
    const a = porPartida.get(l.partida_id!);
    const monto = Number(l.parcial ?? 0);
    // Lo retenido por garantía se le debe al proveedor hasta que entre en su OS de retenciones: no es saldo libre.
    const retenido = l.retenida_en ? 0 : Number(l.retenido ?? 0);
    if (a) {
      if (PAGADO.has(l.estado ?? "")) {
        a.pagado += monto;
        a.porPagar += retenido;
      } else if (l.estado === "EN_TESORERIA") a.porPagar += monto + retenido;
      else a.enLogistica += monto + retenido;
    }
    if (l.numero_oc === numero) {
      const e = estaOrden.get(l.partida_id!) ?? { monto: 0, cantidad: 0 };
      e.monto += monto + retenido;
      e.cantidad += Number(l.cantidad ?? 0);
      estaOrden.set(l.partida_id!, e);
    }
  }

  const sumar = (destino: Avance, a: Avance) => {
    destino.presupuesto += a.presupuesto;
    destino.pagado += a.pagado;
    destino.porPagar += a.porPagar;
    destino.enLogistica += a.enLogistica;
  };
  const obra = vacio();
  const etapasOrden = new Set<string>();
  const items: ContextoCompra["items"] = [];
  for (const p of partidas) {
    const a = porPartida.get(p.partida_id!)!;
    sumar(obra, a);
    const e = estaOrden.get(p.partida_id!);
    if (e) {
      etapasOrden.add(p.etapa ?? "");
      items.push({ ...a, partidaId: p.partida_id!, etapa: p.etapa ?? "", descripcion: p.descripcion ?? "", unidad: p.unidad ?? "", cantidad: e.cantidad, estaOrden: e.monto });
    }
  }
  const etapas = [...etapasOrden].map((etapa) => {
    const t = { ...vacio(), etapa };
    for (const p of partidas) if (p.etapa === etapa) sumar(t, porPartida.get(p.partida_id!)!);
    return t;
  });
  return { obra, etapas, items };
}
