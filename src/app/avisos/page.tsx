import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { rutaEnProd1 } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { ActivarPush, MarcarLeidas } from "./avisos-cliente";
import { ListaAvisos } from "./lista-avisos";

export const metadata: Metadata = { title: "Avisos" };

export default async function AvisosPage() {
  const sesion = await requireSesion();
  const supabase = await createClient();
  const { data: avisos } = await supabase
    .from("notificaciones")
    .select("id, titulo, cuerpo, href, leida_at, created_at")
    .eq("user_id", sesion.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  const hayNuevos = (avisos ?? []).some((a) => !a.leida_at);

  return (
    <>
      <TopBar title="Avisos" back right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <ActivarPush />
        {hayNuevos && <MarcarLeidas />}
        <ListaAvisos avisos={(avisos ?? []).map((a) => (a.href && !rutaEnProd1(a.href) ? { ...a, href: null } : a))} />
      </main>
    </>
  );
}
