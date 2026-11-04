import "server-only";
import { cookies } from "next/headers";
import type { ComponentProps, ReactNode } from "react";
import { ContextoCompraVista } from "@/components/contexto-compra";
import { Entregas } from "@/components/entregas";
import { listarAdjuntos, urlsComprobantes } from "@/lib/adjuntos";
import { contextoCompra } from "@/lib/contexto-compra";
import { cookieDiseno, leerDisenoItems } from "@/lib/diseno";
import { cargarEntregas } from "@/lib/entregas";
import { fecha } from "@/lib/format";
import { pagosDeOrden } from "@/lib/pagos-orden";
import { rechazosDeOrden } from "@/lib/rechazos";
import { todas } from "@/lib/paginar";
import { urlPublica } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { ESTADO_LABEL, TIPO_COMPROBANTE_LABEL, type VOcItem, type VOrden } from "@/lib/types";
import { DetallePago } from "./detalle-pago";

type Props = ComponentProps<typeof DetallePago>;

/**
 * Todo lo de una orden para verla completa: datos, ítems con sus precios de referencia y avance, total con
 * detracción y retención, comprobantes con su archivo, documentos (PDF de la orden, contrato, guía), pagos con
 * voucher, rechazos, entregas y el presupuesto. Lo usan el pago de Tesorería y la consulta de solo lectura
 * de Gerencia: en la consulta no hay formulario de pago ni acciones.
 */
export async function vistaOrden(
  obraId: number,
  numero: string,
  { modo, volverA, extraEntregas }: { modo: "tesoreria" | "consulta"; volverA: string | true; extraEntregas?: ReactNode },
): Promise<Props | null> {
  const supabase = await createClient();
  const [{ data: orden }, { data: items, error: eItems }, { data: doc }, { data: oc }] = await Promise.all([
    supabase.from("v_ordenes").select("*").eq("obra_id", obraId).eq("numero", numero).maybeSingle(),
    supabase.from("v_oc_items").select("*").eq("obra_id", obraId).eq("numero_oc", numero).order("id"),
    supabase.from("v_por_pagar").select("*").eq("obra_id", obraId).eq("numero", numero).maybeSingle(),
    supabase.from("ordenes_compra").select("valorizacion_id, es_retencion, historico").eq("obra_id", obraId).eq("numero", numero).maybeSingle(),
  ]);
  // OS de una valorización o de la retención: su P.U. ya es neto de retención, no se compara.
  const manoObra = oc?.valorizacion_id != null || oc?.es_retencion === true;
  if (eItems) throw new Error(eItems.message);
  if (!orden) return null;

  // La orden dentro del presupuesto de la obra (en paralelo con lo demás).
  const contextoP = contextoCompra(obraId, numero);
  const itemIds = [...new Set(items.map((i) => i.item_id!))];
  const comprobanteIds = [...new Set(items.map((i) => i.comprobante_id).filter((c): c is number => c != null))];

  const [hist, { data: comprobantes }, { data: prov }, pagos, adjuntos, rechazos, { data: guia }, { data: compHist }] = await Promise.all([
    todas((a, b) =>
      supabase
        .from("v_oc_items_calc")
        .select("item_id, obra_id, numero_oc, fecha, pu_efectivo")
        .in("item_id", itemIds)
        .neq("estado", "ANULADA")
        .not("pu_efectivo", "is", null)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b),
    ),
    supabase.from("v_comprobantes").select("id, tipo, serie, numero, archivo_path, fecha_emision, total, retencion, detraccion, pagado, asiento_id").in("id", comprobanteIds.length ? comprobanteIds : [-1]),
    supabase.from("proveedor_cuentas").select("banco, cuenta_bancaria").eq("proveedor_id", orden.proveedor_id!).maybeSingle(),
    pagosDeOrden(obraId, numero, comprobanteIds),
    listarAdjuntos({ obraId, numeroOc: numero }),
    rechazosDeOrden(obraId, numero),
    // La guía de remisión registrada (con su archivo).
    supabase
      .from("guias")
      .select("numero_guia, archivo_path, estado")
      .eq("obra_id", obraId)
      .eq("numero_oc", numero)
      .in("estado", ["EMITIDA", "ANULACION_PENDIENTE", "ANULADA"])
      .order("solicitado_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Comprobantes del Excel (pueden no tener archivo).
    supabase.from("comprobantes").select("id").eq("historico", true).in("id", comprobanteIds.length ? comprobanteIds : [-1]),
  ]);
  const historicos = new Set((compHist ?? []).map((c) => c.id));

  // Precios de otras órdenes del mismo ítem (la actual no cuenta para comparar).
  const h = new Map<number, { min: number; max: number; ultimo: number }>();
  for (const x of hist) {
    if (x.obra_id === obraId && x.numero_oc === numero) continue;
    const pu = Number(x.pu_efectivo);
    const prev = h.get(x.item_id!);
    if (!prev) h.set(x.item_id!, { min: pu, max: pu, ultimo: pu });
    else h.set(x.item_id!, { ...prev, min: Math.min(prev.min, pu), max: Math.max(prev.max, pu) });
  }
  const [urls, urlGuia] = await Promise.all([
    urlsComprobantes((comprobantes ?? []).map((c) => c.archivo_path).filter((p): p is string => !!p)),
    guia?.archivo_path
      ? supabase.storage
          .from("documentos")
          .createSignedUrl(guia.archivo_path, 3600)
          .then((r) => (r.data?.signedUrl ? urlPublica(r.data.signedUrl) : null))
      : null,
  ]);

  // Avance de cada partida del presupuesto (ejecutado / presupuestado).
  const { data: avance } = await supabase
    .from("v_avance_partida")
    .select("partida_id, presupuestado, comprado, parcial, monto_comprado")
    .in("partida_id", [...new Set(items.map((i) => i.partida_id!))]);
  const avancePorPartida = new Map((avance ?? []).map((a) => [a.partida_id, a]));
  const entregas = orden.estado === "EN_ENTREGA" || orden.estado === "RECIBIDA" ? await cargarEntregas(obraId, numero) : null;
  const contrato = adjuntos.filter((a) => a.tipo === "CONTRATO");
  const total = Number(doc?.total ?? orden.total ?? 0);
  // Al rechazar, la factura se anula para que el proveedor emita otra, salvo que ya no se pueda.
  const { data: otrasLineas } =
    modo === "tesoreria" && comprobanteIds.length
      ? await supabase.from("oc_items").select("obra_id, numero_oc").in("comprobante_id", comprobanteIds)
      : { data: [] };
  const otraOrden = (otrasLineas ?? []).find((l) => l.obra_id !== obraId || l.numero_oc !== numero);
  const sinAnular = (comprobantes ?? []).some((c) => Number(c.pagado) > 0)
    ? "La factura ya tiene pagos"
    : (comprobantes ?? []).some((c) => c.asiento_id != null)
      ? "La factura ya está contabilizada"
      : otraOrden
        ? `La factura también es de la orden ${otraOrden.numero_oc}`
        : null;
  const pagado = Number(doc?.pagado ?? orden.pagado ?? 0);
  const pantallaDiseno = modo === "tesoreria" ? "orden-tesoreria" : "orden-consulta";

  return {
    pantallaDiseno,
    diseno: leerDisenoItems((await cookies()).get(cookieDiseno(pantallaDiseno))?.value),
    volverA,
    titulo: `${orden.tipo} ${orden.numero}`,
    datos: [
      ["Proveedor", orden.proveedor ?? "", true],
      ["RUC", orden.proveedor_ruc ?? "", true],
      ...(prov ? ([["Banco", prov.banco ?? ""], ["Cuenta", prov.cuenta_bancaria ?? "", true]] as [string, string, boolean?][]) : []),
      ["Obra", orden.obra ?? ""],
      ["Fecha", fecha(orden.fecha)],
      ...(oc?.historico ? ([["Origen", "Histórico (Excel)"]] as [string, string][]) : []),
      ...(modo === "consulta" ? ([["Estado", orden.estado ? ESTADO_LABEL[orden.estado] : ""]] as [string, string][]) : []),
    ],
    lineas: items.map((i) => {
      const x = h.get(i.item_id!);
      return {
        id: i.id!,
        descripcion: i.descripcion ?? "",
        unidad: i.unidad ?? "",
        cantidad: Number(i.cantidad),
        pu: i.pu_efectivo,
        parcial: i.parcial,
        puMin: manoObra ? null : (x?.min ?? null),
        puMax: manoObra ? null : (x?.max ?? null),
        puUltimo: manoObra ? null : (x?.ultimo ?? null),
        partidaId: i.partida_id!,
        presupuestado: Number(avancePorPartida.get(i.partida_id!)?.presupuestado ?? 0),
        ejecutado: Number(avancePorPartida.get(i.partida_id!)?.comprado ?? 0),
        montoPresupuestado: Number(avancePorPartida.get(i.partida_id!)?.parcial ?? 0),
        montoEjecutado: Number(avancePorPartida.get(i.partida_id!)?.monto_comprado ?? 0),
        puPresupuesto: orden.tipo === "OS" && !manoObra ? Number(i.pu_partida) : null,
        etapa: i.etapa,
        requerimiento: i.requerimiento,
      };
    }),
    comprobantes: (comprobantes ?? []).map((c) => {
      const url = c.archivo_path ? urls.get(c.archivo_path) : undefined;
      return {
        id: c.id!,
        etiqueta: `${TIPO_COMPROBANTE_LABEL[c.tipo!]} ${c.serie}-${c.numero}`,
        fechaEmision: c.fecha_emision,
        total: Number(c.total),
        retencion: Number(c.retencion ?? 0),
        detraccion: Number(c.detraccion ?? 0),
        archivo: url ? { url, nombre: c.archivo_path!.split("/").pop()!, mime: null } : null,
        historico: historicos.has(c.id!),
      };
    }),
    enlaces: [
      ...contrato.map((c) => ({ label: `Contrato ${c.nombre}`, url: c.url })),
      ...(urlGuia ? [{ label: `Guía de remisión ${guia?.numero_guia ?? ""}${guia?.estado === "ANULADA" ? " (anulada)" : ""}`.trim(), url: urlGuia }] : []),
    ],
    pdfOrden: { orden: orden as VOrden, items: items as VOcItem[] },
    total,
    pagado,
    // En la consulta no se paga: sin saldo, no hay formulario ni acciones.
    saldo: modo === "tesoreria" && doc?.estado === "PENDIENTE" ? Number(doc.saldo) : 0,
    pagos,
    bloqueo: modo === "tesoreria" && doc?.falta_guia ? "Falta la guía de remisión: Logística debe registrarla antes del pago" : null,
    entregas: (entregas || extraEntregas) && (
      <>
        {entregas && <Entregas obraId={obraId} numero={numero} lineas={entregas.lineas} entregas={entregas.entregas} />}
        {extraEntregas}
      </>
    ),
    contexto: <ContextoCompraVista contexto={await contextoP} pantalla={modo} />,
    rechazos,
    sinAnular,
    destino: { obraId, numero, ordenPagoId: null },
    bancoDefault: prov?.banco ?? null,
    carpetaVoucher: `pagos/${orden.empresa_id}/${obraId}-${numero}`,
  };
}
