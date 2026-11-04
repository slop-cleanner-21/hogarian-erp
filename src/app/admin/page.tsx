import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";
import type { Rol } from "@/lib/types";
import { ROL_LABEL } from "@/lib/usuarios";
import { UsuariosLista, type Usuario } from "./usuarios-lista";

export const metadata: Metadata = { title: "Usuarios" };

/** Usuarios (solo el Admin): crear cuentas, cambiar nombre, correo y rol, restablecer contraseña y desactivar. */
export default async function UsuariosPage() {
  const sesion = await requireSesionVigente(["ADMIN"]);
  const db = createAdminClient();
  const [cuentas, { data: perfiles, error }, { data: privados }] = await Promise.all([
    todasLasCuentas(db),
    db.from("perfiles").select("user_id, nombre, rol"),
    db.from("perfil_privado").select("user_id, dni"),
  ]);
  if (error) throw new Error(error.message);
  const perfil = new Map(perfiles.map((p) => [p.user_id, p]));
  const dni = new Map((privados ?? []).map((p) => [p.user_id, p.dni]));
  const usuarios: Usuario[] = cuentas
    .map((u) => ({
      id: u.id,
      nombre: perfil.get(u.id)?.nombre ?? "",
      email: u.email ?? "",
      dni: dni.get(u.id) ?? "",
      rol: (perfil.get(u.id)?.rol ?? null) as Rol | null,
      activo: activa(u.banned_until),
      ultimoIngreso: u.last_sign_in_at ?? null,
      yo: u.id === sesion.userId,
    }))
    .sort((a, b) => Number(b.activo) - Number(a.activo) || (a.rol ? ROL_LABEL[a.rol] : "~").localeCompare(b.rol ? ROL_LABEL[b.rol] : "~") || a.nombre.localeCompare(b.nombre));

  return (
    <>
      <TopBar title="Usuarios" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <UsuariosLista usuarios={usuarios} />
      </main>
    </>
  );
}

/** Sin baneo vigente (desactivar banea la cuenta). */
const activa = (hasta: string | null | undefined) => !hasta || new Date(hasta).getTime() <= Date.now();

/** Las cuentas de Supabase, por páginas. */
async function todasLasCuentas(db: ReturnType<typeof createAdminClient>) {
  const todas = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    todas.push(...data.users);
    if (data.users.length < 1000) return todas;
  }
}
