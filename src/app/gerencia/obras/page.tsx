import type { Metadata } from "next";
import { ListaObras } from "@/app/presupuesto/lista-obras";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { DetraccionMinimo } from "./detraccion-minimo";
import { NuevaObra } from "./nueva-obra";

export const metadata: Metadata = { title: "Obras" };

export default async function ObrasGerenciaPage({ searchParams }: PageProps<"/gerencia/obras">) {
  const sesion = await requireSesion(["GERENCIA"]);
  const tab = (await searchParams).tab === "bor" ? "bor" : "pub";
  const supabase = await createClient();
  const [{ data: empresas }, { data: parametros }] = await Promise.all([
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("parametros").select("detraccion_minimo").maybeSingle(),
  ]);
  return (
    <>
      <TopBar title="Obras" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="gerencia-obras" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-24 pt-3">
        <DetraccionMinimo monto={Number(parametros?.detraccion_minimo ?? 700)} />
        <ListaObras base="/gerencia/obras" tab={tab} />
      </main>
      <NuevaObra empresas={empresas ?? []} />
    </>
  );
}
