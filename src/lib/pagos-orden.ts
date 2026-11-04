import "server-only";
import { listarAdjuntos } from "@/lib/adjuntos";
import { createClient } from "@/lib/supabase/server";

export type PagoDeOrden = {
  id: number;
  fecha: string;
  banco: string | null;
  numero_operacion: string | null;
  monto: number;
  /** Pago cargado del Excel: puede no tener voucher. */
  historico: boolean;
  vouchers: { nombre: string; url: string; mime: string | null }[];
};

/**
 * Pagos de una OC/OS (directos a la orden o a sus comprobantes), agrupados por pago, con sus
 * vouchers firmados. Un pago puede repartirse entre varios comprobantes de la orden.
 */
export async function pagosDeOrden(obraId: number, numero: string, comprobanteIds: number[]): Promise<PagoDeOrden[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pago_aplicaciones")
    .select("pago_id, monto, pagos(fecha, banco, numero_operacion, historico)")
    .or(
      [
        `and(obra_id.eq.${obraId},numero_oc.eq."${numero.replace(/"/g, "")}")`,
        comprobanteIds.length ? `comprobante_id.in.(${comprobanteIds.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(","),
    );
  if (error) throw new Error(error.message);

  const porPago = new Map<number, PagoDeOrden>();
  for (const a of data ?? []) {
    const p = a.pagos as { fecha: string; banco: string | null; numero_operacion: string | null; historico: boolean } | null;
    const prev = porPago.get(a.pago_id);
    if (prev) prev.monto += Number(a.monto);
    else
      porPago.set(a.pago_id, {
        id: a.pago_id,
        fecha: p?.fecha ?? "",
        banco: p?.banco ?? null,
        numero_operacion: p?.numero_operacion ?? null,
        historico: p?.historico ?? false,
        monto: Number(a.monto),
        vouchers: [],
      });
  }
  const vouchers = await listarAdjuntos({ pagoIds: [...porPago.keys()] });
  for (const v of vouchers) porPago.get(v.pago_id ?? -1)?.vouchers.push({ nombre: v.nombre, url: v.url, mime: v.mime });
  return [...porPago.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}
