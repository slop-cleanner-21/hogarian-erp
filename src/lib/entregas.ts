import "server-only";
import { urlPublica } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type LineaEntrega = {
  ocItemId: number;
  descripcion: string;
  unidad: string;
  pedido: number;
  entregado: number;
};

export type EntregaFila = {
  id: number;
  ocItemId: number;
  cantidad: number;
  fecha: string;
  rol: string;
  /** Hay coordenadas GPS de la captura. */
  conUbicacion: boolean;
  mapa: string | null;
  fotos: string[];
  /** Material dañado, imprevisto… (null si llegó sin observación). */
  observacion: string | null;
};

const UNA_HORA = 60 * 60;

/** Líneas de la orden con lo entregado y cada entrega con sus fotos (URL firmadas). */
export async function cargarEntregas(obraId: number, numero: string) {
  const supabase = await createClient();
  const [{ data: items, error: e1 }, { data: avance, error: e2 }, { data: entregas, error: e3 }] = await Promise.all([
    supabase.from("v_oc_items_calc").select("id, descripcion, unidad, cantidad").eq("obra_id", obraId).eq("numero_oc", numero).order("id"),
    supabase.from("v_entregas_item").select("oc_item_id, entregado").eq("obra_id", obraId).eq("numero_oc", numero),
    supabase
      .from("entregas")
      .select("id, oc_item_id, cantidad, rol, lat, lng, created_at, observacion, entrega_fotos(path)")
      .eq("obra_id", obraId)
      .eq("numero_oc", numero)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  if (e1 || e2 || e3) throw new Error((e1 ?? e2 ?? e3)!.message);

  const paths = (entregas ?? []).flatMap((e) => e.entrega_fotos.map((f) => f.path));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: firmadas, error } = await supabase.storage.from("documentos").createSignedUrls(paths, UNA_HORA);
    if (error) throw new Error(error.message);
    for (const f of firmadas) if (f.path) urls.set(f.path, urlPublica(f.signedUrl ?? ""));
  }
  const entregado = new Map((avance ?? []).map((a) => [a.oc_item_id, Number(a.entregado)]));

  const lineas: LineaEntrega[] = (items ?? []).map((i) => ({
    ocItemId: i.id!,
    descripcion: i.descripcion ?? "",
    unidad: i.unidad ?? "",
    pedido: Number(i.cantidad),
    entregado: entregado.get(i.id!) ?? 0,
  }));
  const filas: EntregaFila[] = (entregas ?? []).map((e) => ({
    id: e.id,
    ocItemId: e.oc_item_id,
    cantidad: Number(e.cantidad),
    fecha: e.created_at,
    rol: e.rol,
    conUbicacion: e.lat != null,
    mapa: e.lat != null ? `https://www.google.com/maps?q=${e.lat},${e.lng}` : null,
    fotos: e.entrega_fotos.map((f) => urls.get(f.path) ?? "").filter(Boolean),
    observacion: e.observacion,
  }));
  return { lineas, entregas: filas };
}
