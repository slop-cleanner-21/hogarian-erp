import { rutaInterna } from "@/lib/ruta-interna";
import type { Metadata } from "next";
import { PantallaDesbloqueo } from "@/components/huella";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Desbloquear" };

/**
 * Adonde manda el servidor cuando el dispositivo tiene la huella activada y el «desbloqueado» venció: sin pasar por
 * aquí no se entrega ninguna pantalla (src/proxy.ts). `volver`: la pantalla que se pidió.
 */
export default async function DesbloquearPage({ searchParams }: PageProps<"/desbloquear">) {
  await requireSesion();
  const { volver } = await searchParams;
  return <PantallaDesbloqueo volver={rutaInterna(volver)} />;
}
