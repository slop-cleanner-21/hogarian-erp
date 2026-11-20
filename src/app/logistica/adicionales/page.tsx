import type { Metadata } from "next";
import { PaginaAdicionales } from "@/app/adicionales/pagina";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Adicionales" };

/** Logística pide adicionales y ve en qué quedaron (los aprueba Gerencia). */
export default async function AdicionalesLogisticaPage({ searchParams }: PageProps<"/logistica/adicionales">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  return <PaginaAdicionales sp={await searchParams} sesion={sesion} modo="logistica" />;
}
