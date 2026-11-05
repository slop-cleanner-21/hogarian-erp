import "server-only";
import { urlPublica } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "./database.types";

export type TipoAdjunto = Database["public"]["Enums"]["tipo_adjunto"];
export type AdjuntoFirmado = {
  id: number;
  tipo: TipoAdjunto;
  nombre: string;
  mime: string | null;
  pago_id: number | null;
  url: string;
};

const UNA_HORA = 3600;

/** Adjuntos de una orden y/o de pagos, con URL firmada lista para ver o descargar. */
export async function listarAdjuntos(filtro: { obraId: number; numeroOc: string } | { pagoIds: number[] }) {
  const supabase = await createClient();
  let q = supabase.from("adjuntos").select("id, tipo, nombre, mime, pago_id, path").order("created_at").order("id");
  q = "pagoIds" in filtro
    ? q.in("pago_id", filtro.pagoIds.length ? filtro.pagoIds : [-1])
    : q.eq("obra_id", filtro.obraId).eq("numero_oc", filtro.numeroOc);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (data.length === 0) return [];
  const { data: firmadas, error: e2 } = await supabase.storage
    .from("documentos")
    .createSignedUrls(data.map((a) => a.path), UNA_HORA);
  if (e2) throw new Error(e2.message);
  const url = new Map(firmadas.map((f) => [f.path, urlPublica(f.signedUrl ?? "")]));
  return data.map<AdjuntoFirmado>((a) => ({
    id: a.id,
    tipo: a.tipo,
    nombre: a.nombre,
    mime: a.mime,
    pago_id: a.pago_id,
    url: url.get(a.path) ?? "",
  }));
}

/** URLs firmadas de los archivos de comprobantes (bucket `comprobantes`). */
export async function urlsComprobantes(paths: string[]) {
  if (paths.length === 0) return new Map<string, string>();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("comprobantes").createSignedUrls(paths, UNA_HORA);
  if (error) throw new Error(error.message);
  return new Map(data.map((f) => [f.path ?? "", urlPublica(f.signedUrl ?? "")]));
}
