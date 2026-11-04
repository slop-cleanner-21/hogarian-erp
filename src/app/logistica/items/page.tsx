import type { Metadata } from "next";
import { requireSesion } from "@/lib/supabase/server";
import { PaginaItems } from "./pagina";

export const metadata: Metadata = { title: "Ítems" };

export default async function ItemsPage({ searchParams }: PageProps<"/logistica/items">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  return <PaginaItems sp={await searchParams} sesion={sesion} modo="logistica" />;
}
