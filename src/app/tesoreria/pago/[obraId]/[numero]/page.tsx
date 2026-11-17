import type { Metadata } from "next";
import { aLaOrdenRenumerada } from "@/lib/renumeradas";
import { requireSesion } from "@/lib/supabase/server";
import { DetallePago } from "../../detalle-pago";
import { vistaOrden } from "../../vista-orden";

export async function generateMetadata({ params }: PageProps<"/tesoreria/pago/[obraId]/[numero]">): Promise<Metadata> {
  return { title: `Pago ${decodeURIComponent((await params).numero)}` };
}

export default async function PagoOrdenPage({ params, searchParams }: PageProps<"/tesoreria/pago/[obraId]/[numero]">) {
  await requireSesion(["TESORERIA"]);
  // Abierta desde el historial del presupuesto: «Volver» regresa allí (con sus filtros).
  const volverA = (await searchParams).desde === "presupuesto" ? "/tesoreria/consultas" : "/tesoreria";
  const { obraId, numero } = await params;
  const props = await vistaOrden(Number(obraId), decodeURIComponent(numero), { modo: "tesoreria", volverA });
  // Un link viejo de una orden que cambió de N° lleva a la orden con su N° nuevo.
  if (!props) return aLaOrdenRenumerada("/tesoreria/pago", Number(obraId), decodeURIComponent(numero));
  return <DetallePago key={`${props.pagado}`} {...props} />;
}
