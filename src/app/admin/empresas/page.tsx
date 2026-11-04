import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";
import { EmpresasLista } from "./empresas-lista";

export const metadata: Metadata = { title: "Empresas" };

/** Empresas (solo el Admin): razón social, RUC, dirección fiscal y quién firma sus contratos. */
export default async function EmpresasPage() {
  const sesion = await requireSesionVigente(["ADMIN"]);
  const db = createAdminClient();
  const [{ data: empresas, error }, { data: gerentes }] = await Promise.all([
    db.from("empresas").select("id, nombre, razon_social, ruc, direccion, firmante_id").order("nombre"),
    db.from("perfiles").select("user_id, nombre").eq("rol", "GERENCIA").order("nombre"),
  ]);
  if (error) throw new Error(error.message);
  const { data: privados } = gerentes?.length
    ? await db.from("perfil_privado").select("user_id, dni, firma_path").in("user_id", gerentes.map((g) => g.user_id))
    : { data: [] };
  const priv = new Map((privados ?? []).map((p) => [p.user_id, p]));

  return (
    <>
      <TopBar title="Empresas" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <EmpresasLista
          empresas={empresas.map((e) => ({
            id: e.id,
            nombre: e.nombre,
            razonSocial: e.razon_social,
            ruc: e.ruc,
            direccion: e.direccion,
            firmanteId: e.firmante_id,
          }))}
          gerentes={(gerentes ?? []).map((g) => ({
            id: g.user_id,
            nombre: g.nombre,
            conFirma: !!priv.get(g.user_id)?.firma_path,
            conDni: !!priv.get(g.user_id)?.dni,
          }))}
        />
      </main>
    </>
  );
}
