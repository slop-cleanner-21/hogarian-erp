import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { rutaEnProd1 } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { eventosDe, porDefecto } from "@/lib/avisos";
import { ActivarPush, MarcarLeidas } from "./avisos-cliente";
import { PreferenciasAvisos } from "./preferencias";
import { ListaAvisos } from "./lista-avisos";

export const metadata: Metadata = { title: "Avisos" };

export default async function AvisosPage() {
  const sesion = await requireSesion();
  const supabase = await createClient();
  const [{ data: avisos }, { data: elegidas }] = await Promise.all([
    supabase
      .from("notificaciones")
      .select("id, titulo, cuerpo, href, leida_at, created_at")
      .eq("user_id", sesion.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
    supabase.from("aviso_preferencias").select("tipo, avisar, celular").eq("user_id", sesion.userId),
  ]);
  // Qué avisos puede elegir su rol, con lo que eligió (o el defecto: los suyos, sí; los de los demás, no).
  const elegida = new Map((elegidas ?? []).map((e) => [e.tipo, e]));
  const eventos = eventosDe(sesion.rol);
  const preferencias = eventos.map((e) => ({ tipo: e.tipo, label: e.label, area: e.area, ...porDefecto(e.propio), ...(elegida.get(e.tipo) ?? {}) }));
  const hayNuevos = (avisos ?? []).some((a) => !a.leida_at);

  return (
    <>
      <TopBar title="Avisos" back right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <ActivarPush />
        {preferencias.length > 0 && <PreferenciasAvisos eventos={preferencias} agrupar={eventos.some((e) => !e.propio)} />}
        {hayNuevos && <MarcarLeidas />}
        <ListaAvisos avisos={(avisos ?? []).map((a) => (a.href && !rutaEnProd1(a.href) ? { ...a, href: null } : a))} />
      </main>
    </>
  );
}
