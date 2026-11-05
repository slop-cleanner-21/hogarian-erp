import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { leerInvitacion, recienUsado } from "@/lib/bienvenida";
import { createClient } from "@/lib/supabase/server";
import { celularLegible } from "@/lib/usuarios";
import { FormularioBienvenida } from "./formulario";

export const metadata: Metadata = { title: "Bienvenida", robots: { index: false, follow: false } };

/**
 * Link de bienvenida (de un solo uso, lo genera el Admin): completa sus datos (solo esta vez) y crea su contraseña;
 * después, opcionalmente, activa la huella. Público: no hace falta sesión.
 */
export default async function BienvenidaPage({ params }: PageProps<"/bienvenida/[token]">) {
  const { token } = await params;
  const inv = await leerInvitacion(token);
  // Recién usado por esta misma sesión: sigue el paso de la huella.
  const usado = !inv && (await recienUsado(token, (await (await createClient()).auth.getClaims()).data?.claims?.sub ?? null));
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      {usado ? (
        <FormularioBienvenida token={token} email="" dniObligatorio={false} inicial={{ nombres: "", apellidos: "", dni: "", telefono: "" }} usado />
      ) : inv ? (
        <FormularioBienvenida
          token={token}
          email={inv.email}
          dniObligatorio={inv.rol === "GERENCIA"}
          inicial={{ nombres: inv.nombres, apellidos: inv.apellidos, dni: inv.dni, telefono: inv.telefono ? celularLegible(inv.telefono) : "" }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <h1 className="rotulo text-[30px] font-semibold leading-tight text-ink-2">Este link ya no sirve</h1>
          <ButtonLink href="/login" size="lg">
            Ir al ingreso
          </ButtonLink>
        </div>
      )}
    </main>
  );
}
