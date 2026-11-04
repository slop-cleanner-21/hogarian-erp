import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaginaObra } from "@/app/presupuesto/obra";
import { requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Obra" };

export default async function ObraGerenciaPage({ params }: PageProps<"/gerencia/obras/[id]">) {
  await requireSesion(["GERENCIA"]);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  return <PaginaObra obraId={id} volver="/gerencia/obras" />;
}
