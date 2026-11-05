import { ROLES_SEGUIMIENTO } from "@/lib/prod1";
import type { Metadata } from "next";
import { PaginaSeguimiento } from "@/app/presupuesto/seguimiento";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seguimiento" };

/** Seguimiento de los 3 presupuestos de cualquier obra: en qué etapa está lo presupuestado. */
export default async function SeguimientoPage({ searchParams }: PageProps<"/operaciones">) {
  const sesion = await requireSesion(ROLES_SEGUIMIENTO);
  return <PaginaSeguimiento sp={await searchParams} sesion={sesion} clave="seguimiento-operaciones" titulo="Seguimiento" />;
}
