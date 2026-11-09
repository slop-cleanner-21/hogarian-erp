import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DocumentoPagado = {
  label: string;
  detalle: string | null;
  monto: number;
  /** Solo en órdenes de pago: su id y la cuenta contable (la asigna Contabilidad). */
  ordenPagoId: number | null;
  cuenta: string | null;
  /** Dónde se ve completo: la consulta de la orden o el detalle de la OP. */
  href: string | null;
};

export type PagoFila = {
  id: number;
  fecha: string;
  banco: string | null;
  numero_operacion: string;
  monto: number;
  empresa: string;
  proveedores: string;
  documentos: DocumentoPagado[];
  asiento_id: number | null;
};

type Prov = { razon_social: string } | null;
type Raw = {
  id: number;
  fecha: string;
  banco: string | null;
  numero_operacion: string;
  monto: number;
  empresas: { nombre: string } | null;
  asientos: { id: number }[];
  pago_aplicaciones: {
    monto: number;
    obra_id: number | null;
    numero_oc: string | null;
    comprobantes: { serie: string; numero: string; proveedores: Prov } | null;
    ordenes_compra: { tipo: string; proveedores: Prov } | null;
    ordenes_pago: { id: number; numero: string; concepto: string; cuenta_contable: string | null; proveedores: Prov } | null;
  }[];
};

export async function listarPagos({
  contabilizados,
  q,
  limite,
  orden = { columna: "fecha", asc: false },
  banco = null,
  empresa = null,
}: {
  contabilizados?: boolean;
  q?: string;
  limite: number;
  orden?: { columna: "fecha" | "monto" | "numero_operacion"; asc: boolean };
  banco?: string | null;
  empresa?: number | null;
}) {
  const supabase = await createClient();
  let query = supabase
    .from("pagos")
    .select(
      `id, fecha, banco, numero_operacion, monto,
       empresas(nombre),
       asientos(id),
       pago_aplicaciones(
         monto, obra_id, numero_oc,
         comprobantes(serie, numero, proveedores(razon_social)),
         ordenes_compra(tipo, proveedores(razon_social)),
         ordenes_pago(id, numero, concepto, cuenta_contable, proveedores(razon_social))
       )`,
    )
    .order(orden.columna, { ascending: orden.asc })
    .order("id", { ascending: false })
    .limit(limite);
  if (banco) query = query.eq("banco", banco);
  if (empresa) query = query.eq("empresa_id", empresa);
  if (contabilizados === false) query = query.is("asientos", null);
  if (contabilizados === true) query = query.not("asientos", "is", null);
  if (q) query = query.ilike("numero_operacion", `%${q.replace(/[%,()]/g, " ")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Raw[]).map<PagoFila>((p) => ({
    id: p.id,
    fecha: p.fecha,
    banco: p.banco,
    numero_operacion: p.numero_operacion,
    monto: Number(p.monto),
    empresa: p.empresas?.nombre ?? "",
    asiento_id: p.asientos[0]?.id ?? null,
    proveedores: [
      ...new Set(
        p.pago_aplicaciones.map(
          (a) =>
            a.comprobantes?.proveedores?.razon_social ??
            a.ordenes_compra?.proveedores?.razon_social ??
            a.ordenes_pago?.proveedores?.razon_social ??
            "",
        ),
      ),
    ]
      .filter(Boolean)
      .join(", "),
    documentos: p.pago_aplicaciones.map((a) => ({
      label: a.comprobantes
        ? `${a.comprobantes.serie}-${a.comprobantes.numero}`
        : a.ordenes_pago
          ? a.ordenes_pago.numero
          : `${a.ordenes_compra?.tipo ?? "OC"} ${a.numero_oc}`,
      detalle: a.ordenes_pago?.concepto ?? null,
      monto: Number(a.monto),
      ordenPagoId: a.ordenes_pago?.id ?? null,
      cuenta: a.ordenes_pago?.cuenta_contable ?? null,
      href: a.ordenes_pago
        ? `/contabilidad/op/${a.ordenes_pago.id}`
        : a.obra_id && a.numero_oc
          ? `/consulta/orden/${a.obra_id}/${encodeURIComponent(a.numero_oc)}`
          : null,
    })),
  }));
}
