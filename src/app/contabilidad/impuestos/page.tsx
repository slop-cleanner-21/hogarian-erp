import type { Metadata } from "next";
import { FiltroOrden } from "@/components/filtro-orden";
import { Tabs } from "@/components/list-controls";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro } from "@/lib/filtros";
import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { DetraccionesPorPagar, PagosImpuesto, RetencionesPorPagar, type GrupoRetencion } from "./impuestos";

export const metadata: Metadata = { title: "Impuestos" };

/**
 * Contabilidad paga las detracciones (al proveedor, en su cuenta del Banco de la Nación) y las retenciones de 4ta (a
 * SUNAT, por mes) y registra cada pago con su constancia (migración prod1_pagos_impuestos).
 */
export default async function ImpuestosPage({ searchParams }: PageProps<"/contabilidad/impuestos">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const imp = sp.imp === "ret" ? "ret" : "det";
  const est = sp.est === "pag" ? "pag" : "pend";
  const empresa = Number(filtro(sp, "empresa")) || null;
  const supabase = await createClient();
  const { data: empresas } = await supabase.from("empresas").select("id, nombre").order("nombre");

  let contenido: React.ReactNode;
  if (est === "pag") {
    let q = supabase
      .from("impuesto_pagos")
      .select("id, empresa_id, tipo, periodo, fecha, numero, monto, anulado_at, anulado_motivo, empresas(nombre), impuesto_pago_comprobantes(count)")
      .eq("tipo", imp === "det" ? "DETRACCION" : "RETENCION_4TA")
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);
    if (empresa) q = q.eq("empresa_id", empresa);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    contenido = (
      <PagosImpuesto
        pagos={data.map((p) => ({
          id: p.id,
          empresa: (p.empresas as { nombre: string } | null)?.nombre ?? "",
          tipo: p.tipo as "DETRACCION" | "RETENCION_4TA",
          periodo: p.periodo,
          fecha: p.fecha,
          numero: p.numero,
          monto: Number(p.monto),
          comprobantes: (p.impuesto_pago_comprobantes as unknown as { count: number }[])[0]?.count ?? 0,
          anulado: p.anulado_at != null,
          motivo: p.anulado_motivo,
        }))}
      />
    );
  } else if (imp === "det") {
    let q = supabase
      .from("v_detracciones")
      .select("comprobante_id, empresa_id, empresa, proveedor_id, proveedor, proveedor_ruc, cuenta_detracciones, serie, numero, fecha_emision, total, detraccion, pagado_proveedor")
      .is("impuesto_pago_id", null)
      .order("fecha_emision")
      .order("comprobante_id");
    if (empresa) q = q.eq("empresa_id", empresa);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    contenido = (
      <DetraccionesPorPagar
        filas={data.map((d) => ({
          comprobanteId: d.comprobante_id!,
          empresaId: d.empresa_id!,
          empresa: d.empresa ?? "",
          proveedorId: d.proveedor_id!,
          proveedor: d.proveedor ?? "",
          ruc: d.proveedor_ruc ?? "",
          cuenta: d.cuenta_detracciones,
          documento: `${d.serie}-${d.numero}`,
          emision: d.fecha_emision!,
          total: Number(d.total),
          detraccion: Number(d.detraccion),
          pagadoProveedor: d.pagado_proveedor,
        }))}
      />
    );
  } else {
    let q = supabase
      .from("v_retenciones_4ta")
      .select("comprobante_id, empresa_id, empresa, proveedor, proveedor_ruc, serie, numero, total, retencion, pagado_proveedor, periodo")
      .is("impuesto_pago_id", null)
      .order("periodo")
      .order("pagado_proveedor")
      .order("comprobante_id");
    if (empresa) q = q.eq("empresa_id", empresa);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const grupos = new Map<string, GrupoRetencion>();
    for (const r of data) {
      const clave = `${r.empresa_id}-${r.periodo}`;
      const g = grupos.get(clave) ?? { empresaId: r.empresa_id!, empresa: r.empresa ?? "", periodo: r.periodo!, total: 0, recibos: [] };
      g.recibos.push({
        id: r.comprobante_id!,
        proveedor: r.proveedor ?? "",
        ruc: r.proveedor_ruc ?? "",
        documento: `${r.serie}-${r.numero}`,
        pagado: r.pagado_proveedor!,
        total: Number(r.total),
        retencion: Number(r.retencion),
      });
      g.total = Math.round((g.total + Number(r.retencion)) * 100) / 100;
      grupos.set(clave, g);
    }
    contenido = <RetencionesPorPagar grupos={[...grupos.values()]} />;
  }

  return (
    <>
      <TopBar title="Impuestos" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="contabilidad-impuestos" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-24 pt-3">
        <Tabs
          param="imp"
          current={imp}
          options={[
            { value: "det", label: "Detracciones" },
            { value: "ret", label: "Retenciones 4ta" },
          ]}
        />
        <Tabs
          param="est"
          current={est}
          options={[
            { value: "pend", label: "Por pagar" },
            { value: "pag", label: "Pagadas" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <FiltroOrden
            ordenDefault="fecha.asc"
            orden={[]}
            filtros={[
              {
                param: "empresa",
                label: "Empresa",
                todos: "Todas",
                options: (empresas ?? []).map((e) => ({ value: String(e.id), label: e.nombre })),
              },
            ]}
          />
        </div>
        {contenido}
      </main>
    </>
  );
}
