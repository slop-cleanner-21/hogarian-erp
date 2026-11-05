import "server-only";
import { urlPublica } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/** Una entrega (recepción de OC o ejecución de OS) de una partida, con sus fotos firmadas. */
export type EntregaPartida = { id: number; cantidad: number; fecha: string; rol: string; fotos: string[]; observacion?: string | null };

/**
 * Entregas de una obra agrupadas por partida, con las fotos ya firmadas. Su suma por partida es
 * lo que llegó. Sin datos de órdenes ni proveedores.
 */
export async function entregasPorPartida(obraId: number): Promise<Record<number, EntregaPartida[]>> {
  const supabase = await createClient();
  const filas: { id: number; cantidad: number; created_at: string; rol: string; observacion: string | null; oc_items: unknown; entrega_fotos: { path: string }[] }[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from("entregas")
      .select("id, cantidad, created_at, rol, observacion, oc_items(partida_id), entrega_fotos(path)")
      .eq("obra_id", obraId)
      .order("created_at")
      // Desempate único: las del Excel comparten la hora de carga; sin él cambiaban de orden entre cargas (y, por
      // páginas de 1000, una podía repetirse o saltarse).
      .order("id")
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...data);
    if (data.length < 1000) break;
  }
  const paths = filas.flatMap((e) => e.entrega_fotos.map((f) => f.path));
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await supabase.storage.from("documentos").createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const f of data ?? []) if (f.path && f.signedUrl) urls.set(f.path, urlPublica(f.signedUrl));
  }
  const porPartida: Record<number, EntregaPartida[]> = {};
  for (const e of filas) {
    const partida = (e.oc_items as { partida_id: number } | null)?.partida_id;
    if (!partida) continue;
    (porPartida[partida] ??= []).push({
      id: e.id,
      cantidad: Number(e.cantidad),
      fecha: e.created_at,
      rol: e.rol,
      fotos: e.entrega_fotos.map((f) => urls.get(f.path) ?? "").filter(Boolean),
      observacion: e.observacion,
    });
  }
  return porPartida;
}
