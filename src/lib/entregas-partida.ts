import "server-only";
import { todas } from "@/lib/paginar";
import { urlPublica } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/** Una entrega (recepción de OC o ejecución de OS) de una partida, con sus fotos firmadas. */
export type EntregaPartida = { id: number; cantidad: number; fecha: string; rol: string; fotos: string[]; observacion?: string | null };

/**
 * Entregas de una obra agrupadas por partida, con las fotos ya firmadas. Su suma por partida es lo que llegó. Sin datos de
 * órdenes ni proveedores: se leen de v_entregas_partida, que también puede leer Operaciones (no lee las órdenes).
 */
export async function entregasPorPartida(obraId: number): Promise<Record<number, EntregaPartida[]>> {
  const supabase = await createClient();
  // Desempate único: las del Excel comparten la hora de carga; sin él cambiaban de orden entre cargas (y, por páginas de
  // 1000, una podía repetirse o saltarse).
  const filas = await todas((a, b) =>
    supabase
      .from("v_entregas_partida")
      .select("id, partida_id, cantidad, created_at, rol, observacion")
      .eq("obra_id", obraId)
      .order("created_at")
      .order("id")
      .range(a, b),
  );
  const ids = filas.map((e) => e.id!);
  const fotos = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from("entrega_fotos").select("entrega_id, path").in("entrega_id", ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const f of data ?? []) fotos.set(f.entrega_id, [...(fotos.get(f.entrega_id) ?? []), f.path]);
  }
  const paths = [...fotos.values()].flat();
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await supabase.storage.from("documentos").createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const f of data ?? []) if (f.path && f.signedUrl) urls.set(f.path, urlPublica(f.signedUrl));
  }
  const porPartida: Record<number, EntregaPartida[]> = {};
  for (const e of filas) {
    if (!e.partida_id) continue;
    (porPartida[e.partida_id] ??= []).push({
      id: e.id!,
      cantidad: Number(e.cantidad),
      fecha: e.created_at!,
      rol: e.rol!,
      fotos: (fotos.get(e.id!) ?? []).map((p) => urls.get(p) ?? "").filter(Boolean),
      observacion: e.observacion,
    });
  }
  return porPartida;
}
