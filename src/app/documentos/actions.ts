"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enviarSiLista } from "@/lib/enviar-si-lista";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { Result } from "@/app/logistica/actions";

const Adjunto = z.object({
  tipo: z.enum(["GUIA", "FOTO", "CONTRATO"]),
  obraId: z.number().int().positive(),
  numeroOc: z.string().min(1),
  path: z.string().min(1),
  nombre: z.string().min(1).max(200),
  mime: z.string().nullable(),
});

/** Registra un archivo ya subido al bucket `documentos`. La RLS limita a residentes a FOTO de sus obras. */
export async function registrarAdjunto(input: z.input<typeof Adjunto>, revalidar: string): Promise<Result> {
  const sesion = await requireSesion();
  const p = Adjunto.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  // El contrato firmado no puede ser la factura o el recibo de la orden (pasó en las OS 1000148 y 1000149: se subió el
  // comprobante como contrato y la orden se fue sola a Tesorería sin contrato). La base también lo revisa
  // (fn_contrato_no_comprobante), para los pedidos de una versión anterior de la app.
  if (p.data.tipo === "CONTRATO") {
    const igual = await esUnComprobante(supabase, p.data.obraId, p.data.numeroOc, p.data.path);
    if (igual) {
      await supabase.storage.from("documentos").remove([p.data.path]);
      return { ok: false, error: `Ese archivo es el comprobante ${igual} de la orden, no el contrato: sube el contrato firmado` };
    }
  }
  const { error } = await supabase.from("adjuntos").insert({
    tipo: p.data.tipo,
    obra_id: p.data.obraId,
    numero_oc: p.data.numeroOc,
    path: p.data.path,
    nombre: p.data.nombre,
    mime: p.data.mime,
  });
  if (error) {
    await supabase.storage.from("documentos").remove([p.data.path]);
    return { ok: false, error: error.code === "42501" ? "No tienes permiso para subir este documento" : error.message };
  }
  // El contrato firmado de una OS facturada la completa: va sola a Tesorería.
  if (p.data.tipo === "CONTRATO" && ["LOGISTICA", "ADMIN"].includes(sesion.rol)) {
    const e2 = await enviarSiLista(supabase, p.data.obraId, p.data.numeroOc);
    if (e2) return { ok: false, error: e2 };
  }
  // La ruta la manda el cliente: solo una de la app (sin dominio ni parámetros).
  if (/^\/[\w\-/%.]{0,200}$/.test(revalidar) && !revalidar.startsWith("//")) revalidatePath(revalidar);
  return { ok: true, data: undefined };
}

type Db = Awaited<ReturnType<typeof createClient>>;
const huella = async (archivo: Blob) => createHash("sha256").update(Buffer.from(await archivo.arrayBuffer())).digest("hex");

/** Si el archivo subido es idéntico al de un comprobante de la orden, su serie y número. */
async function esUnComprobante(supabase: Db, obraId: number, numeroOc: string, path: string): Promise<string | null> {
  const { data: lineas } = await supabase.from("oc_items").select("comprobante_id").eq("obra_id", obraId).eq("numero_oc", numeroOc);
  const ids = [...new Set((lineas ?? []).map((l) => l.comprobante_id).filter((c): c is number => c != null))];
  if (!ids.length) return null;
  const { data: comps } = await supabase.from("comprobantes").select("serie, numero, archivo_path").in("id", ids).not("archivo_path", "is", null);
  if (!comps?.length) return null;
  const { data: subido } = await supabase.storage.from("documentos").download(path);
  if (!subido) return null;
  const h = await huella(subido);
  for (const c of comps) {
    const { data: archivo } = await supabase.storage.from("comprobantes").download(c.archivo_path!);
    if (archivo && archivo.size === subido.size && (await huella(archivo)) === h) return `${c.serie}-${c.numero}`;
  }
  return null;
}
