import "server-only";
import { todas } from "@/lib/paginar";
import { createClient } from "@/lib/supabase/server";
import type { PagoPartida } from "@/lib/filtro-pago";

const PAGADAS = new Set(["PAGADA", "EN_ENTREGA", "RECIBIDA"]);

export async function pagoPorPartida(obraId: number): Promise<Map<number, PagoPartida>> {
  const supabase = await createClient();
  const filas = await todas((a, b) =>
    supabase
      .from("v_oc_items_calc")
      .select("partida_id, cantidad, parcial, estado, retenido, retenida_en")
      .eq("obra_id", obraId)
      .in("estado", ["PAGADA", "EN_ENTREGA", "RECIBIDA", "EN_TESORERIA"])
      .range(a, b),
  );
  const m = new Map<number, PagoPartida>();
  for (const f of filas) {
    const p = m.get(f.partida_id!) ?? { pagado: 0, montoPagado: 0, porPagar: 0 };
    // Lo retenido por garantía queda por pagar hasta que entre en su OS de retenciones.
    const retenido = f.retenida_en ? 0 : Number(f.retenido ?? 0);
    if (PAGADAS.has(f.estado ?? "")) {
      p.pagado += Number(f.cantidad ?? 0);
      p.montoPagado += Number(f.parcial ?? 0);
      p.porPagar += retenido;
    } else p.porPagar += Number(f.parcial ?? 0) + retenido;
    m.set(f.partida_id!, p);
  }
  return m;
}
