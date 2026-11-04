import type { Metadata } from "next";
import { PaginaSeguimiento } from "@/app/presupuesto/seguimiento";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seguimiento" };

/** Seguimiento de Gerencia: la misma vista que el del Jefe de Operaciones (en qué etapa está lo presupuestado). */
export default async function SeguimientoGerenciaPage({ searchParams }: PageProps<"/gerencia/presupuesto">) {
  const sesion = await requireSesion(["GERENCIA"]);
  return <PaginaSeguimiento sp={await searchParams} sesion={sesion} clave="seguimiento-gerencia" titulo="Seguimiento" />;
}
