import "server-only";
import { todas } from "@/lib/paginar";
import { createClient } from "@/lib/supabase/server";
import { acumularPagoPartida, ESTADOS_PAGO, type PagoPartida } from "@/lib/filtro-pago";

export async function pagoPorPartida(obraId: number): Promise<Map<number, PagoPartida>> {
  const supabase = await createClient();
  const filas = await todas((a, b) =>
    supabase
      .from("v_oc_items_calc")
      .select("partida_id, cantidad, parcial, estado, es_retencion")
      .eq("obra_id", obraId)
      .in("estado", ESTADOS_PAGO)
      .range(a, b),
  );
  return acumularPagoPartida(filas);
}
