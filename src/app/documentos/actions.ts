"use server";

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
  revalidatePath(revalidar);
  return { ok: true, data: undefined };
}
