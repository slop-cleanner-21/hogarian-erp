import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Las OS cuya garantía devuelve una OS de retenciones (van en su contrato). */
export async function osRetenidas(db: SupabaseClient<Database>, obraId: number, numero: string) {
  const { data } = await db.from("v_os_retenidas").select("numero, fecha, retenido").eq("obra_id", obraId).eq("retenida_en", numero).order("numero");
  return (data ?? []).map((o) => ({ numero: o.numero!, fecha: o.fecha, retenido: Number(o.retenido) }));
}
