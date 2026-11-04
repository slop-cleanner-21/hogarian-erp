import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DetallePago } from "@/app/tesoreria/pago/detalle-pago";
import { vistaOrden } from "@/app/tesoreria/pago/vista-orden";
import { fecha } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { CerrarEntrega } from "./cerrar-entrega";

export async function generateMetadata({ params }: PageProps<"/consulta/orden/[obraId]/[numero]">): Promise<Metadata> {
  return { title: `Orden ${decodeURIComponent((await params).numero)}` };
}

/**
 * Orden en solo lectura (Gerencia): lo mismo que ve Tesorería al pagarla (ítems, total,
 * factura, documentos, pagos con voucher, rechazos, entregas y presupuesto), sin el pago ni las acciones.
 */
export default async function ConsultaOrdenPage({ params }: PageProps<"/consulta/orden/[obraId]/[numero]">) {
  const { obraId: raw, numero: n } = await params;
  const obraId = Number(raw);
  const numero = decodeURIComponent(n);
  const sesion = await requireSesion();
  const supabase = await createClient();
  const { data: cierre } = await supabase
    .from("ordenes_compra")
    .select("estado, entrega_cerrada_at, entrega_cerrada_motivo")
    .eq("obra_id", obraId)
    .eq("numero", numero)
    .maybeSingle();
  const puedeCerrar = cierre?.estado === "EN_ENTREGA" && ["GERENCIA", "ADMIN"].includes(sesion.rol);
  const extra = (cierre?.entrega_cerrada_at || puedeCerrar) && (
    <>
      {cierre?.entrega_cerrada_at && (
        <section className="rounded-panel bg-warn-bg p-4">
          <p className="font-semibold text-warn">Entrega cerrada incompleta el {fecha(cierre.entrega_cerrada_at)}</p>
          {cierre.entrega_cerrada_motivo && <p className="mt-1">{cierre.entrega_cerrada_motivo}</p>}
        </section>
      )}
      {puedeCerrar && <CerrarEntrega obraId={obraId} numero={numero} />}
    </>
  );
  const props = await vistaOrden(obraId, numero, { modo: "consulta", volverA: true, extraEntregas: extra || undefined });
  if (!props) notFound();
  return <DetallePago {...props} />;
}
