import "server-only";
import { cookies } from "next/headers";
import type { ComponentProps, ReactNode } from "react";
import { ContextoCompraDiferido } from "@/components/contexto-compra";
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

  // La orden dentro del presupuesto de la obra: llega aparte (streaming), sin hacer esperar a la pantalla.
  const contextoP = contextoCompra(obraId, numero);
  contextoP.catch(() => {});
  const itemIds = [...new Set(items.map((i) => i.item_id!))];
  const comprobanteIds = [...new Set(items.map((i) => i.comprobante_id).filter((c): c is number => c != null))];

  // Todo lo demás en una sola tanda (antes eran 5 en serie): lo que depende de otra consulta de esta tanda (las URL
  // firmadas) se encadena a ella, sin esperar a las demás.
  const ids = comprobanteIds.length ? comprobanteIds : [-1];
  const comprobantesP = supabase
    .from("v_comprobantes")
    .select("id, tipo, serie, numero, archivo_path, fecha_emision, total, retencion, detraccion, pagado, asiento_id")
    .in("id", ids);
  // La guía de remisión registrada (con su archivo).
  const guiaP = supabase
    .from("guias")
    .select("numero_guia, archivo_path, estado")
    .eq("obra_id", obraId)
    .eq("numero_oc", numero)
    .in("estado", ["EMITIDA", "ANULACION_PENDIENTE", "ANULADA"])
    .order("solicitado_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const [
    hist,
    { data: comprobantes },
    { data: prov },
    pagos,
    adjuntos,
    rechazos,
    { data: guia },
    { data: compHist },
    urls,
    urlGuia,
    { data: avance },
    entregas,
    { data: otrasLineas },
  ] = await Promise.all([
    todas((a, b) =>
      supabase
        .from("v_oc_items_calc")
        .select("item_id, obra_id, numero_oc, fecha, pu_efectivo, pu_bruto")
        .in("item_id", itemIds)
        .neq("estado", "ANULADA")
        .not("pu_efectivo", "is", null)
        .order("fecha", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b),
    ),
    comprobantesP,
    supabase.from("proveedor_cuentas").select("banco, cuenta_bancaria").eq("proveedor_id", orden.proveedor_id!).maybeSingle(),
    pagosDeOrden(obraId, numero, comprobanteIds),
    listarAdjuntos({ obraId, numeroOc: numero }),
    rechazosDeOrden(obraId, numero),
    guiaP,
    // Comprobantes del Excel (pueden no tener archivo).
    supabase.from("comprobantes").select("id").eq("historico", true).in("id", ids),
    comprobantesP.then(({ data }) => urlsComprobantes((data ?? []).map((c) => c.archivo_path).filter((p): p is string => !!p))),
    guiaP.then(({ data: g }) =>
      g?.archivo_path
        ? supabase.storage
            .from("documentos")
            .createSignedUrl(g.archivo_path, 3600)
            .then((r) => (r.data?.signedUrl ? urlPublica(r.data.signedUrl) : null))
        : null,
    ),
    // Avance de cada partida del presupuesto (ejecutado / presupuestado).
    supabase
      .from("v_avance_partida")
      .select("partida_id, presupuestado, comprado, parcial, monto_comprado")
      .in("partida_id", [...new Set(items.map((i) => i.partida_id!))]),
    orden.estado === "EN_ENTREGA" || orden.estado === "RECIBIDA" ? cargarEntregas(obraId, numero) : null,
    // Al rechazar, la factura se anula para que el proveedor emita otra, salvo que ya no se pueda.
    modo === "tesoreria" && comprobanteIds.length
      ? supabase.from("oc_items").select("obra_id, numero_oc").in("comprobante_id", comprobanteIds)
      : { data: [] as { obra_id: number; numero_oc: string }[] },
  ]);
  const historicos = new Set((compHist ?? []).map((c) => c.id));

  // Precios de otras órdenes del mismo ítem (la actual no cuenta para comparar).
  const h = new Map<number, { min: number; max: number; ultimo: number }>();
  for (const x of hist) {
    if (x.obra_id === obraId && x.numero_oc === numero) continue;
    const pu = Number(x.pu_bruto ?? x.pu_efectivo);
    const prev = h.get(x.item_id!);
    if (!prev) h.set(x.item_id!, { min: pu, max: pu, ultimo: pu });
    else h.set(x.item_id!, { ...prev, min: Math.min(prev.min, pu), max: Math.max(prev.max, pu) });
  }
  const avancePorPartida = new Map((avance ?? []).map((a) => [a.partida_id, a]));
  const contrato = adjuntos.filter((a) => a.tipo === "CONTRATO");
  const total = Number(doc?.total ?? orden.total ?? 0);
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
        pu: i.pu_bruto ?? i.pu_efectivo,
        // Antes de la garantía: la línea es cantidad × P.U.; lo retenido se resta en el total.
        parcial: Number(i.parcial ?? 0) + Number(i.retenido ?? 0),
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
    garantia: items.reduce((a, i) => a + Number(i.retenido ?? 0), 0),
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
    contexto: <ContextoCompraDiferido contexto={contextoP} pantalla={modo} />,
    rechazos,
    sinAnular,
    destino: { obraId, numero, ordenPagoId: null },
    bancoDefault: prov?.banco ?? null,
    carpetaVoucher: `pagos/${orden.empresa_id}/${obraId}-${numero}`,
  };
}
