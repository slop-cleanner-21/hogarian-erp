import type { Metadata } from "next";
import { PaginaPresupuesto } from "@/app/presupuesto/pagina";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Presupuesto de obra" };

export default async function ConsultasPage({ searchParams }: PageProps<"/tesoreria/consultas">) {
  const sesion = await requireSesion(["TESORERIA"]);
  return <PaginaPresupuesto sp={await searchParams} sesion={sesion} clave="presupuesto-tesoreria" tabla />;
}
