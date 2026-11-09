import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listarAdjuntos } from "@/lib/adjuntos";
import { requireSesion, createClient } from "@/lib/supabase/server";
import { DetalleOP } from "./detalle-op";

export const metadata: Metadata = { title: "Orden de pago" };

export default async function OrdenPagoPage({ params }: PageProps<"/contabilidad/op/[id]">) {
  await requireSesion(ROLES_CONTABILIDAD);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const supabase = await createClient();
  const [{ data: op }, { data: rechazos }, { data: aplicaciones }, { data: cuentas }] = await Promise.all([
    supabase
      .from("ordenes_pago")
      .select("*, obras(nombre), proveedores(razon_social, ruc_o_cod, proveedor_cuentas(banco, cuenta_bancaria))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("rechazos").select("id, motivo, created_at").eq("orden_pago_id", id).order("created_at", { ascending: false }),
    supabase
      .from("pago_aplicaciones")
      .select("monto, pagos(id, fecha, banco, numero_operacion, asientos(id))")
      .eq("orden_pago_id", id)
      .order("id"),
    supabase.from("cuentas_contables").select("codigo, denominacion").order("codigo"),
  ]);
  if (!op) notFound();
  type PagoRow = { id: number; fecha: string; banco: string | null; numero_operacion: string | null; asientos: { id: number }[] | null };
  const pagos = (aplicaciones ?? []).map((a) => ({ monto: Number(a.monto), pago: a.pagos as unknown as PagoRow }));
  const vouchers = pagos.length ? await listarAdjuntos({ pagoIds: pagos.map((p) => p.pago.id) }) : [];
  const prov = op.proveedores;
  const cta = prov?.proveedor_cuentas;

  return (
    <DetalleOP
      op={{
        id: op.id,
        numero: op.numero,
        estado: op.estado as "BORRADOR" | "EN_TESORERIA" | "PAGADA" | "ANULADA",
        concepto: op.concepto,
        monto: Number(op.monto),
        fecha: op.fecha,
        cuenta: op.cuenta_contable,
        motivoAnulacion: op.motivo_anulacion,
        obra: (op.obras as { nombre: string } | null)?.nombre ?? "",
        beneficiario: prov?.razon_social ?? "",
        ruc: prov?.ruc_o_cod ?? "",
        cuentaBancaria: [cta?.banco, cta?.cuenta_bancaria].filter(Boolean).join(" "),
      }}
      conPagos={pagos.length > 0}
      pagos={pagos.map(({ monto, pago }) => ({
        id: pago.id,
        fecha: pago.fecha,
        banco: pago.banco,
        operacion: pago.numero_operacion,
        monto,
        contabilizado: !!pago.asientos?.length,
        vouchers: vouchers.filter((v) => v.pago_id === pago.id),
      }))}
      rechazos={(rechazos ?? []).map((r) => ({ id: r.id, motivo: r.motivo, fecha: r.created_at }))}
      cuentas={cuentas ?? []}
    />
  );
}
