import type { Metadata } from "next";
import { PaginaAdicionales } from "@/app/adicionales/pagina";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Adicionales" };

/** Gerencia aprueba o rechaza los adicionales que pide Logística. */
export default async function AdicionalesGerenciaPage({ searchParams }: PageProps<"/gerencia/adicionales">) {
  const sesion = await requireSesion(["GERENCIA"]);
  return <PaginaAdicionales sp={await searchParams} sesion={sesion} modo="gerencia" />;
}
