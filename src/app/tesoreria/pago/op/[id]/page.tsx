import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listarAdjuntos } from "@/lib/adjuntos";
import { fecha } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { DetallePago, type PagoHecho } from "../../detalle-pago";

export const metadata: Metadata = { title: "Orden de pago" };

export default async function PagoOpPage({ params }: PageProps<"/tesoreria/pago/op/[id]">) {
  await requireSesion(["TESORERIA"]);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const supabase = await createClient();

  const [{ data: op }, { data: doc }, { data: aplic, error }, { data: rechazos }] = await Promise.all([
    supabase
      .from("ordenes_pago")
      .select("*, obras(nombre, empresa_id), proveedores(razon_social, ruc_o_cod, proveedor_cuentas(banco, cuenta_bancaria))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("v_por_pagar").select("*").eq("orden_pago_id", id).maybeSingle(),
    supabase.from("pago_aplicaciones").select("pago_id, monto, pagos(fecha, banco, numero_operacion)").eq("orden_pago_id", id),
    supabase.from("rechazos").select("id, motivo, created_at").eq("orden_pago_id", id).order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  if (!op) notFound();

  type Aplic = { pago_id: number; monto: number; pagos: { fecha: string; banco: string | null; numero_operacion: string | null } | null };
  const pagos = (aplic as unknown as Aplic[]).map<PagoHecho>((a) => ({
    id: a.pago_id,
    fecha: a.pagos?.fecha ?? "",
    banco: a.pagos?.banco ?? null,
    numero_operacion: a.pagos?.numero_operacion ?? null,
    monto: Number(a.monto),
    vouchers: [],
  }));
  const vouchers = await listarAdjuntos({ pagoIds: pagos.map((p) => p.id) });
  for (const v of vouchers) pagos.find((p) => p.id === v.pago_id)?.vouchers.push({ nombre: v.nombre, url: v.url, mime: v.mime });

  const obra = op.obras as unknown as { nombre: string; empresa_id: number } | null;
  const prov = op.proveedores;
  const cta = prov?.proveedor_cuentas;
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);

  return (
    <DetallePago
      key={`${pagado}`}
      titulo={op.numero}
      datos={[
        ["Beneficiario", prov?.razon_social ?? "", true],
        ["RUC / DNI", prov?.ruc_o_cod ?? "", true],
        ["Banco", cta?.banco ?? ""],
        ["Cuenta", cta?.cuenta_bancaria ?? "", true],
        ["Obra", obra?.nombre ?? ""],
        ["Concepto", op.concepto, true],
        ["Fecha", fecha(op.fecha)],
        ...(op.estado === "ANULADA" ? ([["Anulada", op.motivo_anulacion ?? ""]] as [string, string, boolean?][]) : []),
      ]}
      lineas={[]}
      enlaces={[]}
      total={Number(op.monto)}
      pagado={pagado}
      saldo={op.estado === "EN_TESORERIA" ? Number(doc?.saldo ?? op.monto) : 0}
      pagos={pagos}
      destino={{ obraId: null, numero: null, ordenPagoId: id }}
      bancoDefault={cta?.banco ?? null}
      carpetaVoucher={`pagos/${obra?.empresa_id ?? 0}/OP-${id}`}
      rechazos={(rechazos ?? []).map((r) => ({ id: r.id, motivo: r.motivo, fecha: r.created_at, anuladas: [], correccion: null, por: null, reenviado: null }))}
    />
  );
}
