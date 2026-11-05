import "server-only";
import type { RechazoVer } from "@/components/historial-rechazos";
import { createClient } from "@/lib/supabase/server";

/**
 * Rechazos de Tesorería de una orden, del más reciente al más antiguo: qué pidió corregir, quién, el
 * motivo, las facturas que anuló y, si ya volvió, cuándo, quién la reenvió y qué se corrigió.
 */
export async function rechazosDeOrden(obraId: number, numero: string): Promise<RechazoVer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rechazos")
    .select("id, motivo, created_at, created_by, comprobantes_anulados, correccion, reenviado_at, reenviado_by, nota_reenvio")
    .eq("obra_id", obraId)
    .eq("numero", numero)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const ids = [...new Set((data ?? []).flatMap((r) => [r.created_by, r.reenviado_by]).filter((u): u is string => !!u))];
  const { data: perfiles } = ids.length ? await supabase.from("perfiles").select("user_id, nombre").in("user_id", ids) : { data: [] };
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id, p.nombre]));
  return (data ?? []).map((r) => ({
    id: r.id,
    motivo: r.motivo,
    fecha: r.created_at,
    anuladas: r.comprobantes_anulados ?? [],
    correccion: (r.correccion as RechazoVer["correccion"]) ?? null,
    por: r.created_by ? (nombre.get(r.created_by) ?? null) : null,
    reenviado: r.reenviado_at
      ? { fecha: r.reenviado_at, por: r.reenviado_by ? (nombre.get(r.reenviado_by) ?? null) : null, nota: r.nota_reenvio }
      : null,
  }));
}
