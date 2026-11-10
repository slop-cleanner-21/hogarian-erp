import { osRetenidas } from "@/lib/retenidas";
import { cookies } from "next/headers";
import { rechazosDeOrden } from "@/lib/rechazos";
import { representanteContratos } from "@/lib/representante";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Documentos } from "@/components/documentos";
import { listarAdjuntos } from "@/lib/adjuntos";
import { Entregas } from "@/components/entregas";
import { cargarEntregas } from "@/lib/entregas";
import { pagosDeOrden } from "@/lib/pagos-orden";
import { qty } from "@/lib/format";
import { urlPublica } from "@/lib/supabase/config";
import { ComprobantesOrden, type ComprobanteOrden } from "./comprobantes-orden";
import { GuiaRemision, type GuiaOrden } from "./guia";
import { createClient } from "@/lib/supabase/server";
import type { VOcItem, VOrden } from "@/lib/types";
import { DetalleOrden } from "./detalle-orden";
import { ContextoCompraDiferido } from "@/components/contexto-compra";
import { cookieDiseno, leerDisenoItems } from "@/lib/diseno";
import { contextoCompra } from "@/lib/contexto-compra";
import { urlsComprobantes } from "@/lib/adjuntos";
import { todas } from "@/lib/paginar";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/logistica/ordenes/[obraId]/[numero]">): Promise<Metadata> {
  const [{ numero }, sp] = await Promise.all([params, searchParams]);
  const tipo = sp.tipo === "OS" ? "OS" : sp.tipo === "OC" ? "OC" : "Orden";
  return { title: `${tipo} ${decodeURIComponent(numero)}` };
}

export default async function OrdenPage({ params }: PageProps<"/logistica/ordenes/[obraId]/[numero]">) {
  const { obraId, numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const supabase = await createClient();
  // La retención de 4ta se hace al pagar: sus recibos aún sin pagar, con la suspensión vigente hoy.
  await supabase.rpc("refrescar_retencion_orden", { p_obra_id: Number(obraId), p_numero: numero });
  // La orden dentro del presupuesto de la obra (en paralelo con lo demás).
  const contextoP = contextoCompra(Number(obraId), numero);
  contextoP.catch(() => {});
  // Lo ejecutado de cada partida de la orden (diseño de ítems «Con avance»).
  const avanceP = (async () => {
    const { data: partidas } = await supabase.from("oc_items").select("partida_id").eq("obra_id", Number(obraId)).eq("numero_oc", numero);
    const ids = [...new Set((partidas ?? []).map((p) => p.partida_id))];
    if (!ids.length) return [];
    const { data } = await supabase
      .from("v_avance_partida")
      .select("partida_id, presupuestado, comprado, parcial, monto_comprado")
      .eq("obra_id", Number(obraId))
      .in("partida_id", ids);
    return data ?? [];
  })();

  const [{ data: orden }, { data: items }, adjuntos, { data: cot }, { count: vistas }, { data: detracciones }, { data: parametros }] = await Promise.all([
    supabase.from("v_ordenes").select("*").eq("obra_id", Number(obraId)).eq("numero", numero).maybeSingle(),
    supabase
      .from("v_oc_items")
      .select("*")
      .eq("obra_id", Number(obraId))
      .eq("numero_oc", numero)
      .order("id"),
    listarAdjuntos({ obraId: Number(obraId), numeroOc: numero }),
    supabase
      .from("ordenes_compra")
      .select("cotizacion_estado, cotizacion_enviada_at, cotizacion_recibida_at, requiere_guia, entrega_cerrada_at, entrega_cerrada_motivo, valorizacion_id, es_retencion, retenida_en, comprobante_tipo, fecha_inicio, historico")
      .eq("obra_id", Number(obraId))
      .eq("numero", numero)
      .maybeSingle(),
    supabase
      .from("cotizacion_accesos")
      .select("id", { count: "exact", head: true })
      .eq("obra_id", Number(obraId))
      .eq("numero", numero)
      .eq("accion", "VER")
      .eq("ok", true),
    supabase.from("detracciones").select("item_id, porcentaje").eq("obra_id", Number(obraId)),
    supabase.from("parametros").select("detraccion_minimo").maybeSingle(),
  ]);
  if (!orden) notFound();

  const comprobanteIds = [...new Set((items ?? []).map((i) => i.comprobante_id).filter((c): c is number => c != null))];
  // Las OS de valorización y de retención no tienen entregas: lo ejecutado está en la valorización.
  const manoObra = cot?.valorizacion_id != null || cot?.es_retencion === true;
  const conEntregas = (orden.estado === "EN_ENTREGA" || orden.estado === "RECIBIDA") && !manoObra;
  const esOC = orden.tipo === "OC";
  // Una sola ola más: lo que depende de otra consulta (la URL de la guía, las de los comprobantes, los nombres del
  // historial) se encadena a su propia promesa en vez de esperar a toda la ola.
  const [
    { data: prov },
    rechazos,
    pagos,
    entregas,
    { guia, urlGuia },
    { data: transportistas },
    { comps, urlsComp },
    { historial, nombreEditor },
    representante,
  ] = await Promise.all([
    supabase
      .from("proveedores")
      .select("comprobante_habitual, retencion_4ta_pct, suspension_4ta_fecha, contactos:proveedor_contactos(nombre, telefono, whatsapp, telegram)")
      .eq("id", orden.proveedor_id!)
      .maybeSingle(),
    rechazosDeOrden(Number(obraId), numero),
    // Pagos: la constancia se envía con la orden pagada y se sigue viendo en las etapas siguientes.
    ["PAGADA", "EN_ENTREGA", "RECIBIDA"].includes(orden.estado ?? "")
      ? pagosDeOrden(Number(obraId), numero, comprobanteIds)
      : Promise.resolve([]),
    conEntregas ? cargarEntregas(Number(obraId), numero) : Promise.resolve(null),
    supabase
      .from("guias")
      .select("*")
      .eq("obra_id", Number(obraId))
      .eq("numero_oc", numero)
      .order("solicitado_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(async ({ data: guia }) => ({
        guia,
        urlGuia: guia?.archivo_path
          ? await supabase.storage
              .from("documentos")
              .createSignedUrl(guia.archivo_path, 3600)
              .then((r) => (r.data?.signedUrl ? urlPublica(r.data.signedUrl) : null))
          : null,
      })),
    esOC
      ? supabase.from("transportistas").select("id, ruc, razon_social, placa, licencia").order("razon_social")
      : Promise.resolve({ data: [] }),
    supabase
      .from("v_comprobantes")
      .select("id, tipo, serie, numero, fecha_emision, total, retencion, detraccion, archivo_path, asiento_id, pagado")
      .in("id", comprobanteIds.length ? comprobanteIds : [-1])
      .order("id")
      .then(async ({ data: comps }) => ({
        comps,
        urlsComp: await urlsComprobantes((comps ?? []).map((c) => c.archivo_path).filter((p): p is string => !!p)),
      })),
    supabase
      .from("comprobantes_historial")
      .select("id, comprobante_id, anterior, nuevo, motivo, editado_at, editado_by")
      .in("comprobante_id", comprobanteIds.length ? comprobanteIds : [-1])
      .order("editado_at", { ascending: false })
      .then(async ({ data: historial }) => {
        const ids = [...new Set((historial ?? []).map((h) => h.editado_by).filter((u): u is string => !!u))];
        const { data: editores } = ids.length ? await supabase.from("perfiles").select("user_id, nombre").in("user_id", ids) : { data: [] };
        return { historial, nombreEditor: new Map((editores ?? []).map((e) => [e.user_id, e.nombre])) };
      }),
    // El firmante del contrato (solo OS), a la vez que lo demás.
    orden.tipo === "OS" ? representanteContratos(orden.empresa_id ?? null, { conFirma: false }) : Promise.resolve(null),
  ]);

  // OS: sus servicios no llevan contrato (todos marcados «sin contrato» por Logística).
  const sinContratoP =
    orden.tipo === "OS" && (items ?? []).length
      ? supabase
          .from("items")
          .select("id, sin_contrato")
          .in("id", [...new Set((items ?? []).map((i) => i.item_id!))])
          .then((r) => (r.data ?? []).length > 0 && (r.data ?? []).every((i) => i.sin_contrato))
      : Promise.resolve(false);

  // OS: el proveedor se puede cambiar hasta que se le envía el contrato (sin comprobante).
  const cambiaProveedor =
    orden.tipo === "OS" &&
    !cot?.es_retencion &&
    (orden.estado === "EMITIDA" || orden.estado === "PRECIOS_CONFIRMADOS") &&
    !orden.contrato_enviado_at &&
    !adjuntos.some((a) => a.tipo === "CONTRATO") &&
    (items ?? []).every((i) => i.comprobante_id == null);
  const proveedoresCambio = cambiaProveedor
    ? (
        await todas((a, b) => supabase.from("proveedores").select("id, razon_social, ruc_o_cod").order("razon_social").order("id").range(a, b))
      ).filter((p) => p.id !== orden.proveedor_id)
    : null;

  return (
    <DetalleOrden
      proveedoresCambio={proveedoresCambio}
      manoObra={manoObra}
      // Precios nuevos (p. ej. el proveedor envió su cotización): el formulario parte de lo guardado.
      // Solo si cambian los precios, el link o llega un rechazo: un cambio de estado (p. ej. tras registrar la factura) no rearma la
      // pantalla, que cerraría una hoja abierta con lo que se lleva escrito.
      key={(items ?? []).map((i) => `${i.id}:${i.pu_cotizado}:${i.pu_aprobado}`).join("|") + `|${orden.token_cotizacion}|${rechazos.length}`}
      orden={orden as VOrden}
      items={(items ?? []) as VOcItem[]}
      comprobanteHabitual={prov?.comprobante_habitual ?? null}
      requiereGuia={cot?.requiere_guia ?? false}
      historico={cot?.historico ?? false}
      retenidaEn={cot?.retenida_en ?? null}
      retencionProveedor={{ pct: Number(prov?.retencion_4ta_pct ?? 8), suspension: prov?.suspension_4ta_fecha ?? null }}
      contrato={
        orden.tipo === "OS"
          ? {
              comprobante: (cot?.comprobante_tipo as "RXH" | "FACTURA" | null) ?? null,
              fechaInicio: cot?.fecha_inicio ?? null,
              ...representante!,
              ...(cot?.es_retencion ? { retenidas: await osRetenidas(supabase, Number(obraId), numero) } : {}),
            }
          : undefined
      }
      detracciones={Object.fromEntries((detracciones ?? []).map((d) => [d.item_id, Number(d.porcentaje)]))}
      detraccionMinimo={Number(parametros?.detraccion_minimo ?? 700)}
      contactos={prov?.contactos ?? []}
      rechazos={rechazos}
      pagos={pagos}
      comprobantes={
        <ComprobantesOrden
          obraId={Number(obraId)}
          numero={numero}
          empresaId={orden.empresa_id!}
          proveedorRuc={orden.proveedor_ruc ?? ""}
          esOS={orden.tipo === "OS"}
          retencionProveedor={{ pct: Number(prov?.retencion_4ta_pct ?? 8), suspension: prov?.suspension_4ta_fecha ?? null }}
          comprobantes={(comps ?? []).map((c) => ({
            id: c.id!,
            tipo: c.tipo!,
            serie: c.serie ?? "",
            numero: c.numero ?? "",
            fecha_emision: c.fecha_emision ?? "",
            total: Number(c.total),
            retencion: Number(c.retencion),
            archivo_path: c.archivo_path,
            url: c.archivo_path ? (urlsComp.get(c.archivo_path) ?? null) : null,
            bloqueado: c.asiento_id != null || Number(c.pagado) > 0,
            historial: (historial ?? [])
              .filter((h) => h.comprobante_id === c.id)
              .map((h) => ({
                id: h.id,
                anterior: h.anterior as unknown as ComprobanteOrden["historial"][number]["anterior"],
                nuevo: h.nuevo as unknown as ComprobanteOrden["historial"][number]["nuevo"],
                motivo: h.motivo,
                editadoAt: h.editado_at,
                quien: (h.editado_by && nombreEditor.get(h.editado_by)) || "",
              })),
          }))}
        />
      }
      entregaCerrada={cot?.entrega_cerrada_at ? { fecha: cot.entrega_cerrada_at, motivo: cot.entrega_cerrada_motivo } : null}
      guia={
        esOC && (
          <GuiaRemision
            obraId={Number(obraId)}
            numero={numero}
            estadoOrden={orden.estado!}
            requiere={cot?.requiere_guia ?? false}
            guia={guia ? { ...guia, estado: guia.estado as GuiaOrden["estado"], modalidad: guia.modalidad as GuiaOrden["modalidad"], url: urlGuia && urlPublica(urlGuia) } : null}
            transportistas={transportistas ?? []}
            detalleSugerido={(items ?? []).map((i) => `${qty(i.cantidad)} ${i.unidad} ${i.descripcion}`).join("\n")}
          />
        )
      }
      contexto={<ContextoCompraDiferido contexto={contextoP} pantalla="logistica" />}
      entregas={
        entregas && (
          <Entregas
            obraId={Number(obraId)}
            numero={numero}
            lineas={entregas.lineas}
            entregas={entregas.entregas}
            registrar={orden.estado === "EN_ENTREGA" ? "archivos" : undefined}
          />
        )
      }
      cotizacion={{
        estado: cot?.cotizacion_estado ?? "SIN_ENVIAR",
        enviadaAt: cot?.cotizacion_enviada_at ?? null,
        recibidaAt: cot?.cotizacion_recibida_at ?? null,
        vistas: vistas ?? 0,
      }}
      contratoFirmado={adjuntos.some((a) => a.tipo === "CONTRATO")}
      sinContrato={orden.tipo === "OS" && !cot?.es_retencion && (await sinContratoP)}
      descuentos={{
        detraccion: (comps ?? []).reduce((a, c) => a + Number(c.detraccion ?? 0), 0),
        retencion: (comps ?? []).reduce((a, c) => a + Number(c.retencion ?? 0), 0),
      }}
      diseno={leerDisenoItems((await cookies()).get(cookieDiseno("orden-logistica"))?.value)}
      avance={Object.fromEntries(
        (await avanceP).map((a) => [
          a.partida_id!,
          {
            presupuestado: Number(a.presupuestado ?? 0),
            ejecutado: Number(a.comprado ?? 0),
            montoPresupuestado: Number(a.parcial ?? 0),
            montoEjecutado: Number(a.monto_comprado ?? 0),
          },
        ]),
      )}
      faltaGuia={esOC && !!cot?.requiere_guia && !cot?.historico && !(guia && ["EMITIDA", "ANULACION_PENDIENTE"].includes(guia.estado))}
      documentos={
        orden.tipo === "OC" ? null : (
          <Documentos
            obraId={Number(obraId)}
            numeroOc={numero}
            adjuntos={adjuntos}
            tipos={["CONTRATO"]}
            subir={orden.estado !== "ANULADA" && orden.tipo === "OS" ? ["CONTRATO"] : []}
            opcionales={cot?.historico ? ["CONTRATO"] : []}
          />
        )
      }
    />
  );
}
