"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX = 2 * 1024 * 1024;

/** La firma del gerente (va en los contratos de las OS). Solo el servidor la lee y la guarda. */
export async function verMiFirma(): Promise<Result<string | null>> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const db = createAdminClient(sesion.userId);
  const { data } = await db.from("perfil_privado").select("firma_path").eq("user_id", sesion.userId).maybeSingle();
  if (!data?.firma_path) return { ok: true, data: null };
  const { data: archivo } = await db.storage.from("documentos").download(data.firma_path);
  if (!archivo) return { ok: true, data: null };
  return { ok: true, data: `data:${archivo.type || "image/png"};base64,${Buffer.from(await archivo.arrayBuffer()).toString("base64")}` };
}

export async function guardarMiFirma(form: FormData): Promise<Result> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const archivo = form.get("firma");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "Elige la imagen de tu firma" };
  const ext = TIPOS[archivo.type];
  if (!ext) return { ok: false, error: "La firma debe ser una imagen PNG, JPG o WEBP" };
  if (archivo.size > MAX) return { ok: false, error: "La imagen pesa más de 2 MB" };

  const db = createAdminClient(sesion.userId);
  const { data: antes } = await db.from("perfil_privado").select("firma_path").eq("user_id", sesion.userId).maybeSingle();
  const path = `firmas/${sesion.userId}-${Date.now()}.${ext}`;
  const { error: up } = await db.storage.from("documentos").upload(path, archivo, { contentType: archivo.type });
  if (up) return { ok: false, error: up.message };
  const { error } = await db
    .from("perfil_privado")
    .upsert({ user_id: sesion.userId, firma_path: path, firma_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    await db.storage.from("documentos").remove([path]);
    return { ok: false, error: error.message };
  }
  if (antes?.firma_path) await db.storage.from("documentos").remove([antes.firma_path]);
  return { ok: true, data: undefined };
}
