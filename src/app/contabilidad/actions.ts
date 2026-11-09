"use server";

import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { Result } from "@/app/logistica/actions";
import { listarAdjuntos, urlsComprobantes, type AdjuntoFirmado } from "@/lib/adjuntos";
import { urlPublica } from "@/lib/supabase/config";

async function db() {
  await requireSesion(ROLES_CONTABILIDAD);
  return createClient();
}

export async function asignarCuenta(itemId: number, cuenta: string): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("asignar_cuenta_item", { p_item_id: itemId, p_cuenta: cuenta });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad");
  return { ok: true, data: undefined };
}

export async function contabilizarComprobante(id: number): Promise<Result<number>> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("contabilizar_comprobante", { p_comprobante_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/compras");
  return { ok: true, data };
}

export async function contabilizarPago(id: number): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("contabilizar_pago", { p_pago_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/pagos");
  return { ok: true, data: undefined };
}

/** `amarre`: cuenta de amarre del plan (las de origen son las del comprobante o el pago). */
export type AsientoLinea = { cuenta: string; denominacion: string; debe: number; haber: number; glosa: string | null; amarre: boolean };

export async function verAsiento(asientoId: number): Promise<Result<{ glosa: string; fecha: string; lineas: AsientoLinea[] }>> {
  // Lectura: también la usa Tesorería en el detalle de un pago.
  await requireSesion([...ROLES_CONTABILIDAD, "TESORERIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asientos")
    .select("glosa, fecha, asiento_lineas(id, cuenta, debe, haber, glosa, amarre, orden, cuentas_contables!asiento_lineas_cuenta_fkey(denominacion))")
    .eq("id", asientoId)
    .order("orden", { referencedTable: "asiento_lineas", nullsFirst: false })
    .order("id", { referencedTable: "asiento_lineas" })
    .single();
  if (error) return { ok: false, error: error.message };
  type Row = { cuenta: string; debe: number; haber: number; glosa: string | null; amarre: boolean; cuentas_contables: { denominacion: string } | null };
  return {
    ok: true,
    data: {
      glosa: data.glosa,
      fecha: data.fecha,
      lineas: (data.asiento_lineas as unknown as Row[]).map((l) => ({
        cuenta: l.cuenta,
        denominacion: l.cuentas_contables?.denominacion ?? "",
        debe: Number(l.debe),
        haber: Number(l.haber),
        glosa: l.glosa,
        amarre: l.amarre,
      })),
    },
  };
}

export async function actualizarPeriodo(comprobanteId: number, periodo: string): Promise<Result> {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return { ok: false, error: "Periodo inválido" };
  const supabase = await db();
  const { error } = await supabase.rpc("actualizar_periodo_anotacion", {
    p_comprobante_id: comprobanteId,
    p_periodo: periodo,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/compras");
  return { ok: true, data: undefined };
}

/** Destino del IGV de una factura en el registro de compras del SIRE. */
export async function cambiarDestinoIgv(comprobanteId: number, destino: "DGNG" | "DNG"): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("cambiar_destino_igv", { p_comprobante_id: comprobanteId, p_destino: destino });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/compras");
  return { ok: true, data: undefined };
}

export type ExpedienteDetalle = {
  archivoUrl: string | null;
  /** Del Excel: le pueden faltar archivos. */
  historico: boolean;
  detraccion: number;
  /** Pagos de su detracción o su retención de 4ta (vigentes). */
  impuestos: { tipo: "DETRACCION" | "RETENCION_4TA"; fecha: string; numero: string }[];
  ordenes: { obra_id: number; numero: string; tipo: "OC" | "OS"; adjuntos: AdjuntoFirmado[] }[];
  vouchers: AdjuntoFirmado[];
  /** Artículos del comprobante con su cuenta contable. */
  lineas: { id: number; descripcion: string; unidad: string; cuenta: string | null; pu: number | null; cantidad: number }[];
};

/** Documentos del expediente de un comprobante: sus órdenes, adjuntos y vouchers de los pagos aplicados. */
export async function expedienteComprobante(comprobanteId: number): Promise<Result<ExpedienteDetalle>> {
  const supabase = await db();
  const [{ data: comp, error: e1 }, { data: lineas, error: e2 }] = await Promise.all([
    supabase.from("comprobantes").select("archivo_path, historico, detraccion").eq("id", comprobanteId).single(),
    supabase
      .from("v_oc_items")
      .select("id, obra_id, numero_oc, descripcion, unidad, cuenta_contable, pu_efectivo, cantidad")
      .eq("comprobante_id", comprobanteId)
      .order("id"),
  ]);
  if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message };
  const { data: impuestos } = await supabase
    .from("impuesto_pago_comprobantes")
    .select("tipo, impuesto_pagos(fecha, numero)")
    .eq("comprobante_id", comprobanteId)
    .eq("vigente", true);

  const claves = [...new Map(lineas.map((l) => [`${l.obra_id}|${l.numero_oc}`, l])).values()];
  const { data: ords, error: e3 } = await supabase
    .from("v_ordenes")
    .select("obra_id, numero, tipo")
    .in("obra_id", [...new Set(claves.map((c) => c.obra_id!))])
    .in("numero", [...new Set(claves.map((c) => c.numero_oc!))]);
  if (e3) return { ok: false, error: e3.message };
  const ordenes = ords
    .filter((o) => claves.some((c) => c.obra_id === o.obra_id && c.numero_oc === o.numero))
    .map((o) => ({ obra_id: o.obra_id!, numero: o.numero!, tipo: o.tipo! }));

  const { data: aplic, error: e4 } = await supabase
    .from("pago_aplicaciones")
    .select("pago_id")
    .eq("comprobante_id", comprobanteId);
  if (e4) return { ok: false, error: e4.message };

  const [porOrden, vouchers, urls] = await Promise.all([
    Promise.all(ordenes.map((o) => listarAdjuntos({ obraId: o.obra_id, numeroOc: o.numero }))),
    listarAdjuntos({ pagoIds: [...new Set(aplic.map((a) => a.pago_id))] }),
    urlsComprobantes(comp.archivo_path ? [comp.archivo_path] : []),
  ]);
  return {
    ok: true,
    data: {
      archivoUrl: comp.archivo_path ? (urls.get(comp.archivo_path) ?? null) : null,
      historico: comp.historico,
      detraccion: Number(comp.detraccion ?? 0),
      impuestos: (impuestos ?? []).map((i) => {
        const p = i.impuesto_pagos as unknown as { fecha: string; numero: string };
        return { tipo: i.tipo as "DETRACCION" | "RETENCION_4TA", fecha: p.fecha, numero: p.numero };
      }),
      ordenes: ordenes.map((o, i) => ({ ...o, adjuntos: porOrden[i] })),
      vouchers,
      lineas: lineas.map((l) => ({
        id: l.id!,
        descripcion: l.descripcion ?? "",
        unidad: l.unidad ?? "",
        cuenta: l.cuenta_contable,
        pu: l.pu_efectivo,
        cantidad: Number(l.cantidad),
      })),
    },
  };
}

/** Vouchers de un pago (Contabilidad y Tesorería los consultan). */
export async function vouchersPago(pagoId: number): Promise<Result<AdjuntoFirmado[]>> {
  await requireSesion([...ROLES_CONTABILIDAD, "TESORERIA"]);
  try {
    return { ok: true, data: await listarAdjuntos({ pagoIds: [pagoId] }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudieron cargar los vouchers" };
  }
}

/** Cuenta contable de una orden de pago (Debe del asiento de su pago). */
export async function asignarCuentaOP(ordenPagoId: number, cuenta: string): Promise<Result> {
  const supabase = await db();
  const { data, error } = await supabase.from("ordenes_pago").update({ cuenta_contable: cuenta }).eq("id", ordenPagoId).select("id");
  if (error) return { ok: false, error: error.message };
  // La base no la deja cambiar en una OP anulada ni con su pago ya contabilizado.
  if (!data?.length) return { ok: false, error: "La cuenta de esta OP ya no se puede cambiar" };
  revalidatePath("/contabilidad/pagos");
  return { ok: true, data: undefined };
}

// ------------------------------------------------------------ órdenes de pago
const OrdenPago = z.object({
  obraId: z.number().int().positive("Selecciona la obra"),
  proveedorId: z.number().int().positive("Selecciona el beneficiario"),
  concepto: z.string().trim().min(3, "Ingresa el concepto").max(300),
  monto: z.number().positive("Ingresa el monto"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  cuenta: z.string().nullable(),
});

export async function crearOrdenPago(input: z.input<typeof OrdenPago>): Promise<Result<number>> {
  const supabase = await db();
  const p = OrdenPago.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const { data: numero, error } = await supabase.rpc("crear_orden_pago", {
    p_obra_id: d.obraId,
    p_proveedor_id: d.proveedorId,
    p_concepto: d.concepto,
    p_monto: d.monto,
    p_fecha: d.fecha,
    p_cuenta: d.cuenta as string,
  });
  if (error) return { ok: false, error: error.message };
  const { data: op, error: e2 } = await supabase
    .from("ordenes_pago")
    .select("id")
    .eq("obra_id", d.obraId)
    .eq("numero", String(numero))
    .single();
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/contabilidad/op");
  return { ok: true, data: op.id };
}

/** La OP pasa a Tesorería para su pago (o rechazo). */
export async function enviarOpATesoreria(id: number): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("enviar_op_a_tesoreria", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/op");
  revalidatePath(`/contabilidad/op/${id}`);
  return { ok: true, data: undefined };
}

export async function anularOrdenPago(id: number, motivo: string): Promise<Result> {
  if (!motivo.trim()) return { ok: false, error: "Ingresa el motivo" };
  const supabase = await db();
  const { error } = await supabase.rpc("anular_orden_pago", { p_id: id, p_motivo: motivo.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/op");
  return { ok: true, data: undefined };
}


// ------------------------------------------------------------ cuentas en lote
/** Misma cuenta para varios ítems. Devuelve cuántos cambiaron. */
export async function asignarCuentaItems(ids: number[], cuenta: string): Promise<Result<number>> {
  if (!ids.length) return { ok: false, error: "Selecciona al menos un ítem" };
  const supabase = await db();
  const { data, error } = await supabase.rpc("asignar_cuenta_items", { p_ids: ids, p_cuenta: cuenta });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad");
  return { ok: true, data: Number(data) };
}

/** Ids de todos los ítems que cumplen los filtros de la pantalla (no solo los cargados). */
export async function idsFiltrados(f: { tab: "sin" | "con"; q: string; rubro: string | null; comprobanteId: number | null }): Promise<Result<number[]>> {
  const supabase = await db();
  let itemIds: number[] | null = null;
  if (f.comprobanteId) {
    const { data, error } = await supabase.from("v_oc_items").select("item_id").eq("comprobante_id", f.comprobanteId);
    if (error) return { ok: false, error: error.message };
    itemIds = [...new Set(data.map((d) => d.item_id!))];
  }
  const like = `%${f.q.trim().replace(/[%,()]/g, " ")}%`;
  const ids: number[] = [];
  for (let desde = 0; ; desde += 1000) {
    let query =
      f.tab === "sin"
        ? supabase.from("v_items_sin_cuenta").select("id:item_id")
        : supabase.from("items").select("id").not("cuenta_contable", "is", null);
    if (f.rubro) query = query.eq("rubro", f.rubro as never);
    if (f.q.trim()) query = query.ilike("descripcion", like);
    if (itemIds) query = query.in(f.tab === "sin" ? "item_id" : "id", itemIds);
    const { data, error } = await query.range(desde, desde + 999);
    if (error) return { ok: false, error: error.message };
    ids.push(...data.map((d) => Number(d.id)));
    if (data.length < 1000) break;
  }
  return { ok: true, data: ids };
}

const CuentaInput = z.object({
  codigo: z.string().trim().regex(/^\d{2,12}$/, "El código tiene de 2 a 12 dígitos"),
  denominacion: z.string().trim().min(2, "Escribe el nombre de la cuenta").max(200),
  tipo: z.enum(["ACTIVO", "PASIVO", "GASTO", "INGRESO", "PATRIMONIO"]),
  // Amarre del plan: las dos cuentas o ninguna.
  amarre_debe: z.string().regex(/^\d{2,12}$/).nullable(),
  amarre_haber: z.string().regex(/^\d{2,12}$/).nullable(),
}).refine((c) => (c.amarre_debe == null) === (c.amarre_haber == null), "El amarre lleva cuenta de Debe y de Haber");

/** Crea una cuenta del plan o cambia su nombre, tipo y amarre (el código no se cambia: lo usan ítems y asientos). */
export async function guardarCuenta(input: unknown, nueva: boolean): Promise<Result> {
  const p = CuentaInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await db();
  const { error } = nueva
    ? await supabase.from("cuentas_contables").insert(p.data)
    : await supabase
        .from("cuentas_contables")
        .update({ denominacion: p.data.denominacion, tipo: p.data.tipo, amarre_debe: p.data.amarre_debe, amarre_haber: p.data.amarre_haber })
        .eq("codigo", p.data.codigo);
  if (error) return { ok: false, error: error.code === "23505" ? "Esa cuenta ya existe" : error.message };
  revalidatePath("/contabilidad");
  return { ok: true, data: undefined };
}

export type ItemCuenta = { id: number; descripcion: string; unidad: string | null; rubro: string };

/** Ítems que usan una cuenta (hoja de la cuenta en el plan de cuentas). */
export async function itemsDeCuenta(codigo: string): Promise<Result<ItemCuenta[]>> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("items")
    .select("id, descripcion, unidad, rubro")
    .eq("cuenta_contable", codigo)
    .order("descripcion")
    .limit(500);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

// ------------------------------------------------------------ detracciones y retenciones de 4ta
const PagoImpuesto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresa la fecha del pago"),
  numero: z.string().trim().min(1, "Ingresa el N° de la constancia").max(40),
  archivo: z.string().min(1, "Sube la constancia"),
});

/** Detracciones de una misma empresa pagadas con una constancia (o un pago masivo). */
export async function pagarDetracciones(input: { ids: number[] } & z.input<typeof PagoImpuesto>): Promise<Result<number>> {
  const p = PagoImpuesto.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!input.ids.length) return { ok: false, error: "Elige las detracciones" };
  const supabase = await db();
  const { data, error } = await supabase.rpc("registrar_pago_detraccion", {
    p_comprobantes: input.ids,
    p_fecha: p.data.fecha,
    p_numero: p.data.numero,
    p_archivo_path: p.data.archivo,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/impuestos");
  return { ok: true, data: Number(data) };
}

/** Las retenciones de 4ta de una empresa en un mes (el del pago de los recibos). `monto`: lo que se vio en pantalla. */
export async function pagarRetenciones(
  input: { empresaId: number; periodo: string; monto: number } & z.input<typeof PagoImpuesto>,
): Promise<Result<number>> {
  const p = PagoImpuesto.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await db();
  const { data, error } = await supabase.rpc("registrar_pago_retencion", {
    p_empresa_id: input.empresaId,
    p_periodo: input.periodo,
    p_monto: input.monto,
    p_fecha: p.data.fecha,
    p_numero: p.data.numero,
    p_archivo_path: p.data.archivo,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/impuestos");
  return { ok: true, data: Number(data) };
}

export async function anularPagoImpuesto(id: number, motivo: string): Promise<Result> {
  if (!motivo.trim()) return { ok: false, error: "Ingresa el motivo" };
  const supabase = await db();
  const { error } = await supabase.rpc("anular_pago_impuesto", { p_id: id, p_motivo: motivo.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/impuestos");
  return { ok: true, data: undefined };
}

/** Cuenta de detracciones del proveedor (Banco de la Nación); vacía la quita. */
export async function guardarCuentaDetracciones(proveedorId: number, cuenta: string): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("guardar_cuenta_detracciones", { p_proveedor_id: proveedorId, p_cuenta: cuenta });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contabilidad/impuestos");
  return { ok: true, data: undefined };
}

export type DetallePagoImpuesto = {
  comprobantes: { id: number; proveedor: string; documento: string; monto: number }[];
  archivoUrl: string | null;
  asientoId: number | null;
};

/** Un pago de impuestos: sus comprobantes, la constancia y el asiento. */
export async function detallePagoImpuesto(id: number): Promise<Result<DetallePagoImpuesto>> {
  const supabase = await db();
  const [{ data: pago, error: e1 }, { data: lineas, error: e2 }, { data: asiento }] = await Promise.all([
    supabase.from("impuesto_pagos").select("archivo_path").eq("id", id).single(),
    supabase
      .from("impuesto_pago_comprobantes")
      .select("monto, comprobantes(id, serie, numero, proveedores(razon_social))")
      .eq("impuesto_pago_id", id)
      .order("comprobante_id"),
    supabase.from("asientos").select("id").eq("impuesto_pago_id", id).maybeSingle(),
  ]);
  if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message };
  const { data: firmada } = await supabase.storage.from("documentos").createSignedUrl(pago.archivo_path, 300);
  type Fila = { monto: number; comprobantes: { id: number; serie: string; numero: string; proveedores: { razon_social: string } | null } | null };
  return {
    ok: true,
    data: {
      comprobantes: (lineas as unknown as Fila[]).map((l) => ({
        id: l.comprobantes?.id ?? 0,
        proveedor: l.comprobantes?.proveedores?.razon_social ?? "",
        documento: `${l.comprobantes?.serie}-${l.comprobantes?.numero}`,
        monto: Number(l.monto),
      })),
      archivoUrl: firmada?.signedUrl ? urlPublica(firmada.signedUrl) : null,
      asientoId: asiento?.id ?? null,
    },
  };
}
