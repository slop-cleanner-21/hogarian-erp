import "server-only";
import type { Representante } from "@/lib/pdf/contrato-pdf";
import { createAdminClient } from "@/lib/supabase/admin";

/** La empresa en los contratos: razón social y domicilio (si el Admin los cargó). */
export type EmpresaContrato = { razonSocial: string | null; direccion: string | null };

/**
 * Quien firma los contratos de la empresa: el firmante que el Admin eligió (Admin › Empresas) o, si no hay, el
 * gerente con la firma más reciente. La firma (data URL) solo con `conFirma`: la vista de la orden no la manda;
 * el PDF la pide al armarse (firmaContrato).
 */
export async function representanteContratos(
  empresaId: number | null,
  { conFirma = true }: { conFirma?: boolean } = {},
): Promise<{ representante: Representante | null; empresa: EmpresaContrato }> {
  const db = createAdminClient();
  const { data: emp } = empresaId
    ? await db.from("empresas").select("razon_social, direccion, firmante_id").eq("id", empresaId).maybeSingle()
    : { data: null };
  const empresa = { razonSocial: emp?.razon_social ?? null, direccion: emp?.direccion ?? null };
  // La firma de la empresa (cada una con su sello), si la hay; si no, la del gerente que firma.
  const { data: deEmpresa } = conFirma && empresaId ? await db.from("empresa_firmas").select("path").eq("empresa_id", empresaId).maybeSingle() : { data: null };
  const firmaDe = async (path: string | null | undefined) => {
    const { data: archivo } = path ? await db.storage.from("documentos").download(path) : { data: null };
    return archivo ? `data:${archivo.type || "image/png"};base64,${Buffer.from(await archivo.arrayBuffer()).toString("base64")}` : null;
  };
  const firmaEmpresa = await firmaDe(deEmpresa?.path);

  let elegido: string | null = emp?.firmante_id ?? null;
  if (!elegido) {
    const { data: gerentes } = await db.from("perfil_roles").select("user_id").eq("rol", "GERENCIA");
    if (!gerentes?.length) return { representante: firmaEmpresa ? { nombre: "", dni: null, firma: firmaEmpresa } : null, empresa };
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
  if (!elegido) return { representante: firmaEmpresa ? { nombre: "", dni: null, firma: firmaEmpresa } : null, empresa };

  const [{ data: perfil }, { data: p }] = await Promise.all([
    db.from("perfiles").select("nombre").eq("user_id", elegido).maybeSingle(),
    db.from("perfil_privado").select("dni, firma_path").eq("user_id", elegido).maybeSingle(),
  ]);
  const firma = firmaEmpresa ?? (conFirma ? await firmaDe(p?.firma_path) : null);
  return { representante: { nombre: perfil?.nombre ?? "", dni: p?.dni ?? null, firma }, empresa };
}
