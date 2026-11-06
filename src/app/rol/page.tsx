import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TopBar, UserMenu } from "@/components/shell";
import { rutaInterna } from "@/lib/ruta-interna";
import { misRoles, requireSesion } from "@/lib/supabase/server";
import type { Rol } from "@/lib/types";
import { ROL_LABEL } from "@/lib/usuarios";
import { CambiarRol } from "./cambiar";

export const metadata: Metadata = { title: "Cambiar de rol" };

/** Una pantalla de otro de sus roles (por ejemplo, desde un aviso): un toque para pasar a ese rol y abrirla. */
export default async function RolPage({ searchParams }: { searchParams: Promise<{ a?: string; volver?: string }> }) {
  const sesion = await requireSesion();
  const { a, volver } = await searchParams;
  const rol = a as Rol;
  if (!(await misRoles()).includes(rol) || rol === sesion.rol) redirect(rutaInterna(volver));
  return (
    <>
      <TopBar title="Cambiar de rol" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-20 pt-6">
        <h2 className="rotulo text-[22px] font-semibold leading-[1.2]">Esta pantalla es de {ROL_LABEL[rol]}</h2>
        <CambiarRol rol={rol} label={ROL_LABEL[rol]} volver={rutaInterna(volver)} />
      </main>
    </>
  );
}
