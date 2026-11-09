"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const TIPOS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX = 2 * 1024 * 1024;

type Db = ReturnType<typeof createAdminClient>;

async function dataUrl(db: Db, path: string | null | undefined) {
  if (!path) return null;
  const { data: archivo } = await db.storage.from("documentos").download(path);
  return archivo ? `data:${archivo.type || "image/png"};base64,${Buffer.from(await archivo.arrayBuffer()).toString("base64")}` : null;
}

/** La imagen recibida, validada (o el error). */
function imagenDe(form: FormData): { archivo: File; ext: string } | { error: string } {
  const archivo = form.get("firma");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige la imagen de la firma" };
  const ext = TIPOS[archivo.type];
  if (!ext) return { error: "La firma debe ser una imagen PNG, JPG o WEBP" };
  if (archivo.size > MAX) return { error: "La imagen pesa más de 2 MB" };
  return { archivo, ext };
}

/** La firma del gerente, si no firma por ninguna empresa en particular. Solo el servidor la lee y la guarda. */
export async function verMiFirma(): Promise<Result<string | null>> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const db = createAdminClient(sesion.userId);
  const { data } = await db.from("perfil_privado").select("firma_path").eq("user_id", sesion.userId).maybeSingle();
  return { ok: true, data: await dataUrl(db, data?.firma_path) };
}

export async function guardarMiFirma(form: FormData): Promise<Result> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const img = imagenDe(form);
  if ("error" in img) return { ok: false, error: img.error };
  const db = createAdminClient(sesion.userId);
  const { data: antes } = await db.from("perfil_privado").select("firma_path").eq("user_id", sesion.userId).maybeSingle();
  const path = `firmas/${sesion.userId}-${Date.now()}.${img.ext}`;
  const { error: up } = await db.storage.from("documentos").upload(path, img.archivo, { contentType: img.archivo.type });
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

export type FirmaEmpresa = { empresaId: number; empresa: string; firma: string | null };

/** Las empresas por las que firma (el Admin: todas), con la firma de cada una. */
export async function misFirmasEmpresa(): Promise<Result<FirmaEmpresa[]>> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const db = createAdminClient(sesion.userId);
  let q = db.from("empresas").select("id, nombre").order("nombre");
  if (sesion.rol !== "ADMIN") q = q.eq("firmante_id", sesion.userId);
  const { data: empresas, error } = await q;
  if (error) return { ok: false, error: error.message };
  const { data: firmas } = await db.from("empresa_firmas").select("empresa_id, path").in("empresa_id", (empresas ?? []).map((e) => e.id));
  const path = new Map((firmas ?? []).map((f) => [f.empresa_id, f.path]));
  return {
    ok: true,
    data: await Promise.all((empresas ?? []).map(async (e) => ({ empresaId: e.id, empresa: e.nombre, firma: await dataUrl(db, path.get(e.id)) }))),
  };
}

/** La firma de una empresa: la cambia el gerente que firma por ella, o el Admin. */
export async function guardarFirmaEmpresa(form: FormData): Promise<Result> {
  const sesion = await requireSesionVigente(["GERENCIA"]);
  const empresaId = Number(form.get("empresa"));
  if (!(empresaId > 0)) return { ok: false, error: "Elige la empresa" };
  const img = imagenDe(form);
  if ("error" in img) return { ok: false, error: img.error };
  const db = createAdminClient(sesion.userId);
  const { data: empresa } = await db.from("empresas").select("id, firmante_id").eq("id", empresaId).maybeSingle();
  if (!empresa) return { ok: false, error: "La empresa no existe" };
  if (sesion.rol !== "ADMIN" && empresa.firmante_id !== sesion.userId) return { ok: false, error: "No firmas por esta empresa" };

  const { data: antes } = await db.from("empresa_firmas").select("path").eq("empresa_id", empresaId).maybeSingle();
  const path = `firmas/empresa-${empresaId}-${Date.now()}.${img.ext}`;
  const { error: up } = await db.storage.from("documentos").upload(path, img.archivo, { contentType: img.archivo.type });
  if (up) return { ok: false, error: up.message };
  const { error } = await db
    .from("empresa_firmas")
    .upsert({ empresa_id: empresaId, path, subida_por: sesion.userId, subida_at: new Date().toISOString() }, { onConflict: "empresa_id" });
  if (error) {
    await db.storage.from("documentos").remove([path]);
    return { ok: false, error: error.message };
  }
  if (antes?.path) await db.storage.from("documentos").remove([antes.path]);
  return { ok: true, data: undefined };
}
