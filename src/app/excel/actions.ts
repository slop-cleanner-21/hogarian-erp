"use server";

import { registrarEvento } from "@/lib/auditoria";
import { leerDatosExcel } from "@/lib/excel-datos";
import { armarLibro } from "@/lib/excel-libro";
import { hoyISO } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { urlPublica } from "@/lib/supabase/config";
import { requireSesionVigente } from "@/lib/supabase/server";

const BUCKET = "excel";
const PLANTILLA = "plantilla.xlsm";
const TIPO_XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";

/**
 * El Excel de control de costos al día, con lo que se registró en la app: mismo libro, mismas fórmulas y macros. Pesa
 * más de lo que una respuesta del servidor permite, así que se guarda y se baja con un enlace que dura 2 minutos.
 */
export async function exportarExcel(): Promise<{ url: string } | { error: string }> {
  const sesion = await requireSesionVigente(["LOGISTICA", "TESORERIA", "GERENCIA"]);
  const db = createAdminClient(sesion.userId);
  try {
    const [{ data: plantilla, error }, datos] = await Promise.all([db.storage.from(BUCKET).download(PLANTILLA), leerDatosExcel(db)]);
    if (error || !plantilla) return { error: "Falta la plantilla del Excel" };
    const { archivo, resumen } = armarLibro(new Uint8Array(await plantilla.arrayBuffer()), datos);

    const ruta = `exportes/${sesion.userId}.xlsm`;
    const { error: e2 } = await db.storage.from(BUCKET).upload(ruta, archivo, { upsert: true, contentType: TIPO_XLSM });
    if (e2) return { error: e2.message };
    const nombre = `CONTROL DE COSTOS ${hoyISO()}.xlsm`;
    const { data: enlace, error: e3 } = await db.storage.from(BUCKET).createSignedUrl(ruta, 120, { download: nombre });
    if (e3 || !enlace) return { error: e3?.message ?? "No se pudo generar el enlace" };
    await registrarEvento({ tabla: "excel", accion: "EXPORTAR_EXCEL", registro: sesion.userId, actor: sesion.userId, detalle: resumen });
    return { url: urlPublica(enlace.signedUrl) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo armar el Excel" };
  }
}
