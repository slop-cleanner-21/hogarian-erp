import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { logout } from "@/app/login/actions";

export const metadata: Metadata = { title: "Sin acceso" };

/** Usuario con un rol que no tiene módulo en prod 1. */
export default function SinAccesoPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <h1 className="rotulo text-[30px] font-semibold leading-tight">Tu usuario no tiene un módulo en esta versión</h1>
      <form action={logout}>
        <button type="submit" className="h-12 w-full rounded-field border border-line bg-surface font-semibold active:bg-sunken">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
