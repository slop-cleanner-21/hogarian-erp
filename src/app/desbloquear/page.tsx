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

/**
 * Solo una ruta de la app, nunca otro dominio. Se resuelve como lo haría el navegador (que toma `\` como `/` y quita
 * tabuladores y saltos: `/\otro.com` y `/<tab>/otro.com` son `//otro.com`) y se exige el mismo origen.
 */
function rutaInterna(volver: string | string[] | undefined) {
  if (typeof volver !== "string" || !volver.startsWith("/")) return "/";
  const base = "https://erp.invalid";
  let url: URL;
  try {
    url = new URL(volver, base);
  } catch {
    return "/";
  }
  const ruta = `${url.pathname}${url.search}`;
  if (url.origin !== base || ruta.startsWith("//") || url.pathname.startsWith("/desbloquear")) return "/";
  return ruta;
}
