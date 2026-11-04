import "server-only";
import type { Representante } from "@/lib/pdf/contrato-pdf";
import { createAdminClient } from "@/lib/supabase/admin";

/** La empresa en los contratos: razón social y domicilio (si el Admin los cargó). */
export type EmpresaContrato = { razonSocial: string | null; direccion: string | null };

/**
 * Quien firma los contratos de la empresa: el firmante que el Admin eligió (Admin › Empresas) o, si no hay, el
 * gerente con la firma más reciente. Con la firma como data URL: el PDF del contrato se arma en el navegador y
 * no depende de otra petición.
 */
export async function representanteContratos(empresaId: number | null): Promise<{ representante: Representante | null; empresa: EmpresaContrato }> {
  const db = createAdminClient();
  const { data: emp } = empresaId
    ? await db.from("empresas").select("razon_social, direccion, firmante_id").eq("id", empresaId).maybeSingle()
    : { data: null };
  const empresa = { razonSocial: emp?.razon_social ?? null, direccion: emp?.direccion ?? null };

  let elegido: string | null = emp?.firmante_id ?? null;
  if (!elegido) {
    const { data: gerentes } = await db.from("perfiles").select("user_id").eq("rol", "GERENCIA");
    if (!gerentes?.length) return { representante: null, empresa };
    const { data: ultimo } = await db
      .from("perfil_privado")
      .select("user_id")
      .in("user_id", gerentes.map((g) => g.user_id))
      .not("firma_path", "is", null)
      .order("firma_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    elegido = ultimo?.user_id ?? null;
  }
  if (!elegido) return { representante: null, empresa };

  const [{ data: perfil }, { data: p }] = await Promise.all([
    db.from("perfiles").select("nombre").eq("user_id", elegido).maybeSingle(),
    db.from("perfil_privado").select("dni, firma_path").eq("user_id", elegido).maybeSingle(),
  ]);
  const { data: archivo } = p?.firma_path ? await db.storage.from("documentos").download(p.firma_path) : { data: null };
  const firma = archivo ? `data:${archivo.type || "image/png"};base64,${Buffer.from(await archivo.arrayBuffer()).toString("base64")}` : null;
  return { representante: { nombre: perfil?.nombre ?? "", dni: p?.dni ?? null, firma }, empresa };
}
