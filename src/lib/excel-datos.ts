import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { DatosExcel } from "./excel-libro";
import { todas } from "./paginar";

// Como los escribe el Excel (GASTOEJEC.G y PROVEED.D).
const TIPO: Record<string, string> = { FACTURA: "FACTURA", RXH: "R.HONORARIOS", BOLETA: "BOLETA", RECIBO_SIMPLE: "RECIBO SIMPLE", OTRO: "OTRO" };
const HABITUAL: Record<string, string> = { FACTURA: "FACTURA", RXH: "RXH", BOLETA: "BOLETA", RECIBO_SIMPLE: "RECIBO" };

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Lo que va al Excel, leído con la clave de servidor (lo usan la exportación y la revisión desde un script). */
export async function leerDatosExcel(db: SupabaseClient<Database>): Promise<DatosExcel> {
  const [empresas, obras, items, proveedores, cuentas, partidas, ordenes, lineas, aplicaciones] = await Promise.all([
    todas((a, b) => db.from("empresas").select("id, nombre, ruc").order("id").range(a, b)),
    todas((a, b) => db.from("obras").select("id, nombre, empresa_id").order("id").range(a, b)),
    todas((a, b) => db.from("items").select("id, descripcion, unidad, rubro, tolerancia_pct").order("id").range(a, b)),
    todas((a, b) => db.from("proveedores").select("id, ruc_o_cod, razon_social, comprobante_habitual, comprobante_excel").order("id").range(a, b)),
    todas((a, b) => db.from("proveedor_cuentas").select("proveedor_id, banco, cuenta_bancaria").order("proveedor_id").range(a, b)),
    todas((a, b) => db.from("partidas").select("id, codigo, obra_id, etapa, requerimiento, item_id, cantidad, pu").order("id").range(a, b)),
    todas((a, b) => db.from("ordenes_compra").select("obra_id, numero, tipo, estado, fecha, historico, proveedor_id").order("obra_id").order("numero").range(a, b)),
    todas((a, b) => db.from("oc_items").select("id, obra_id, numero_oc, partida_id, cantidad, pu_cotizado, pu_aprobado, comprobante_id, precio_fijado_at, ret_garantia_pct, pu_bruto").order("id").range(a, b)),
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
      const tolerancia = o.tipo === "OS" && !o.historico ? 0 : Number(item.get(p.item_id)?.tolerancia_pct ?? 0);
      const cotizado = num(l.pu_cotizado);
      const superaHoy = p.pu !== null && cotizado !== null && cotizado > Number(p.pu) * (1 + tolerancia);
      // El Excel lleva lo que se factura: con garantía, el P.U. neto (las históricas ya lo tienen).
      const neto = (pu: number | null) => (pu === null || l.pu_bruto != null ? pu : Number((pu * (1 - Number(l.ret_garantia_pct) / 100)).toFixed(8)));
      return [
        {
          id: l.id,
          codigo: p.codigo,
          fecha: o.fecha,
          cantidad: Number(l.cantidad),
          pu: neto(num(l.pu_cotizado)),
          aprobado: neto(num(l.pu_aprobado) ?? (l.precio_fijado_at && superaHoy ? cotizado : null)),
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
