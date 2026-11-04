import type { Metadata } from "next";
import { PaginaItems } from "@/app/logistica/items/pagina";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ítems" };

/** Gerencia crea los ítems del catálogo (Logística ya no). */
export default async function ItemsGerenciaPage({ searchParams }: PageProps<"/gerencia/items">) {
  const sesion = await requireSesion(["GERENCIA"]);
  return <PaginaItems sp={await searchParams} sesion={sesion} modo="gerencia" />;
}
