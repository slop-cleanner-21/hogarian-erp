"use server";

import { registrarEvento } from "@/lib/auditoria";
import { armarLibro, type DatosExcel } from "@/lib/excel-libro";
import { hoyISO } from "@/lib/format";
import { todas } from "@/lib/paginar";
import { createAdminClient } from "@/lib/supabase/admin";
import { urlPublica } from "@/lib/supabase/config";
import { requireSesionVigente } from "@/lib/supabase/server";

const BUCKET = "excel";
const PLANTILLA = "plantilla.xlsm";
const TIPO_XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";

// Como los escribe el Excel (GASTOEJEC.G y PROVEED.D).
const TIPO: Record<string, string> = { FACTURA: "FACTURA", RXH: "R.HONORARIOS", BOLETA: "BOLETA", RECIBO_SIMPLE: "RECIBO SIMPLE", OTRO: "OTRO" };
const HABITUAL: Record<string, string> = { FACTURA: "FACTURA", RXH: "RXH", BOLETA: "BOLETA", RECIBO_SIMPLE: "RECIBO" };

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

async function leerDatos(db: ReturnType<typeof createAdminClient>): Promise<DatosExcel> {
  const [empresas, obras, items, proveedores, cuentas, partidas, ordenes, lineas, aplicaciones] = await Promise.all([
    todas((a, b) => db.from("empresas").select("id, nombre, ruc").order("id").range(a, b)),
    todas((a, b) => db.from("obras").select("id, nombre, empresa_id").order("id").range(a, b)),
    todas((a, b) => db.from("items").select("id, descripcion, unidad, rubro, tolerancia_pct").order("id").range(a, b)),
    todas((a, b) => db.from("proveedores").select("id, ruc_o_cod, razon_social, comprobante_habitual, comprobante_excel").order("id").range(a, b)),
    todas((a, b) => db.from("proveedor_cuentas").select("proveedor_id, banco, cuenta_bancaria").order("proveedor_id").range(a, b)),
    todas((a, b) => db.from("partidas").select("id, codigo, obra_id, etapa, requerimiento, item_id, cantidad, pu").order("id").range(a, b)),
    todas((a, b) => db.from("ordenes_compra").select("obra_id, numero, tipo, estado, fecha, historico, proveedor_id").order("obra_id").order("numero").range(a, b)),
    todas((a, b) => db.from("oc_items").select("id, obra_id, numero_oc, partida_id, cantidad, pu_cotizado, pu_aprobado, comprobante_id, precio_fijado_at").order("id").range(a, b)),
    todas((a, b) => db.from("pago_aplicaciones").select("id, comprobante_id, obra_id, numero_oc, pago_id").order("id").range(a, b)),
  ]);
  const [comprobantes, pagos] = await Promise.all([
    todas((a, b) => db.from("comprobantes").select("id, tipo, serie, numero, historico").order("id").range(a, b)),
    todas((a, b) => db.from("pagos").select("id, numero_operacion, historico").order("id").range(a, b)),
  ]);

  const empresa = new Map(empresas.map((e) => [e.id, e]));
  const obra = new Map(obras.map((o) => [o.id, o]));
  const item = new Map(items.map((i) => [i.id, i]));
  const proveedor = new Map(proveedores.map((p) => [p.id, p]));
  const cuenta = new Map<number, (typeof cuentas)[number]>();
  for (const c of cuentas) if (!cuenta.has(c.proveedor_id)) cuenta.set(c.proveedor_id, c);
  const partida = new Map(partidas.map((p) => [p.id, p]));
  const orden = new Map(ordenes.map((o) => [`${o.obra_id}/${o.numero}`, o]));
  const comprobante = new Map(comprobantes.map((c) => [c.id, c]));
  const pago = new Map(pagos.map((p) => [p.id, p]));

  // Solo lo pagado en la app: lo del Excel ya tiene su N° de operación en la plantilla.
  const operaciones = new Map<string, string[]>();
  for (const a of aplicaciones) {
    const p = pago.get(a.pago_id);
    if (!p || p.historico || !p.numero_operacion) continue;
    const k = a.comprobante_id ? `c${a.comprobante_id}` : `o${a.obra_id}/${a.numero_oc}`;
    operaciones.set(k, [...(operaciones.get(k) ?? []), p.numero_operacion]);
  }

  return {
    empresas: empresas.map((e) => ({ nombre: e.nombre, ruc: e.ruc })),
    obras: obras.map((o) => ({ nombre: o.nombre, empresa: empresa.get(o.empresa_id)?.nombre ?? "" })),
    items: items.map((i) => ({ descripcion: i.descripcion, unidad: i.unidad, rubro: i.rubro, tolerancia: Number(i.tolerancia_pct) })),
    proveedores: proveedores.map((p) => ({
      cod: p.ruc_o_cod,
      razon: p.razon_social,
      comprobante: p.comprobante_excel ?? (p.comprobante_habitual ? (HABITUAL[p.comprobante_habitual] ?? null) : null),
      banco: cuenta.get(p.id)?.banco ?? null,
      cuenta: cuenta.get(p.id)?.cuenta_bancaria ?? null,
    })),
    partidas: partidas.map((p) => ({
      codigo: p.codigo,
      obra: obra.get(p.obra_id)?.nombre ?? "",
      etapa: p.etapa,
      requerimiento: p.requerimiento,
      item: item.get(p.item_id)?.descripcion ?? "",
      cantidad: Number(p.cantidad),
      pu: num(p.pu),
    })),
    lineas: lineas.flatMap((l) => {
      const o = orden.get(`${l.obra_id}/${l.numero_oc}`);
      const p = partida.get(l.partida_id);
      if (!o || !p) return [];
      const c = l.comprobante_id ? comprobante.get(l.comprobante_id) : undefined;
      const delApp = c && !c.historico ? c : undefined;
      const ops = (l.comprobante_id ? operaciones.get(`c${l.comprobante_id}`) : undefined) ?? operaciones.get(`o${l.obra_id}/${l.numero_oc}`);
      // El Excel compara cada compra con el presupuesto de hoy. Si Gerencia lo bajó después de aprobar los precios, la orden
      // no cambió: va como sobreprecio aprobado, para que el Excel no la deje en cero.
      const tolerancia = o.tipo === "OS" ? 0 : Number(item.get(p.item_id)?.tolerancia_pct ?? 0);
      const cotizado = num(l.pu_cotizado);
      const superaHoy = p.pu !== null && cotizado !== null && cotizado > Number(p.pu) * (1 + tolerancia);
      return [
        {
          id: l.id,
          codigo: p.codigo,
          fecha: o.fecha,
          cantidad: Number(l.cantidad),
          pu: num(l.pu_cotizado),
          aprobado: num(l.pu_aprobado) ?? (l.precio_fijado_at && superaHoy ? cotizado : null),
          orden: o.numero,
          ruc: proveedor.get(o.proveedor_id)?.ruc_o_cod ?? "",
          tipo: delApp ? (TIPO[delApp.tipo] ?? "OTRO") : null,
          comprobante: delApp ? `${delApp.serie}-${delApp.numero}` : null,
          operacion: ops?.length ? [...new Set(ops)].join(", ") : null,
          historica: o.historico,
          fuera: o.estado === "ANULADA" || (!o.historico && o.estado === "EMITIDA"),
        },
      ];
    }),
  };
}

/**
 * El Excel de control de costos al día, con lo que se registró en la app: mismo libro, mismas fórmulas y macros. Pesa
 * más de lo que una respuesta del servidor permite, así que se guarda y se baja con un enlace que dura 2 minutos.
 */
export async function exportarExcel(): Promise<{ url: string } | { error: string }> {
  const sesion = await requireSesionVigente(["LOGISTICA", "TESORERIA", "GERENCIA"]);
  const db = createAdminClient(sesion.userId);
  try {
    const [{ data: plantilla, error }, datos] = await Promise.all([db.storage.from(BUCKET).download(PLANTILLA), leerDatos(db)]);
    if (error || !plantilla) return { error: "Falta la plantilla del Excel" };
    const { archivo, resumen } = armarLibro(new Uint8Array(await plantilla.arrayBuffer()), datos);

    const ruta = `exportes/${sesion.userId}.xlsm`;
    const { error: e2 } = await db.storage.from(BUCKET).upload(ruta, archivo, { upsert: true, contentType: TIPO_XLSM });
    if (e2) return { error: e2.message };
    const nombre = `CONTROL DE COSTOS ${hoyISO()}.xlsm`;
    const { data: enlace, error: e3 } = await db.storage.from(BUCKET).createSignedUrl(ruta, 120, { download: nombre });
    if (e3 || !enlace) return { error: e3?.message ?? "No se pudo generar el enlace" };
    await registrarEvento({ tabla: "excel", accion: "EXPORTAR_EXCEL", registro: sesion.userId, actor: sesion.userId, detalle: resumen });
    return { url: urlPublica(enlace.signedUrl) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo armar el Excel" };
  }
}
