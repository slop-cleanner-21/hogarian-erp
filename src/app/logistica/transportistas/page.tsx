import type { Metadata } from "next";
import { SearchBox } from "@/components/list-controls";
import { TopBar, UserMenu } from "@/components/shell";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { PestanasProveedores } from "../proveedores/pestanas";
import { TransportistasList } from "./transportistas-list";

export const metadata: Metadata = { title: "Transportistas" };

export default async function TransportistasPage({ searchParams }: PageProps<"/logistica/transportistas">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  const q = (await searchParams).q;
  const supabase = await createClient();
  let query = supabase.from("transportistas").select("id, ruc, razon_social, placa, licencia").order("razon_social");
  if (typeof q === "string" && q.trim()) {
    const like = `%${q.trim().replace(/[%,()]/g, " ")}%`;
    query = query.or(`razon_social.ilike.${like},ruc.ilike.${like},placa.ilike.${like}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <TopBar title="Transportistas" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <PestanasProveedores actual="transportistas" />
        <SearchBox placeholder="Razón social, RUC o placa" />
        <TransportistasList transportistas={data} />
      </main>
    </>
  );
}
