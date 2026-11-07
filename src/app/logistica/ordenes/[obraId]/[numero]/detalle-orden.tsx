"use client";

import { MarcaAdicional } from "@/components/marca-adicional";
import {
  Check,
  Download,
  Eye,
  Link2,
  MoreVertical,
  RotateCcw,
  Paperclip,
  Send,
  Share2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { useCambiosOrden } from "@/lib/realtime";
import { Voucher } from "@/components/voucher";
import { CLASE_TONO, textoDiferencia, tonoPrecio } from "@/lib/precio";
import { IconoWhatsApp } from "@/components/iconos";
import { Lista, Pila } from "@/components/lista";
import { TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input, NumberInput, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, hoyISO, money, qty, soles, solesPu, telefonoIntl } from "@/lib/format";
import { guardar as recordar, leer } from "@/lib/recordar";
import { createClient } from "@/lib/supabase/client";
import { SERIE_INVALIDA, serieValida } from "@/lib/serie";
import {
  ESTADO_LABEL,
  TIPO_COMPROBANTE_LABEL,
  type TipoComprobante,
  type VOcItem,
  type VOrden,
} from "@/lib/types";
import {
  anularOrden,
  guardarPrecios,
  enviarATesoreria,
  reenviarATesoreria,
  enviarConstancia,
  marcarCotizacionEnviada,
  reenviarCotizacion,
  registrarComprobante,
} from "../../../actions";
import { abrirBlob, useEsPwa } from "@/components/visor";
import { CORRECCION_TAREA, HistorialRechazos, type RechazoVer } from "@/components/historial-rechazos";
import { Plegable } from "@/components/plegable";
import Link from "next/link";
import { ContratoOS, type DatosContrato } from "./contrato-os";
import { retenidoDe } from "@/lib/garantia";
import { faltaSuspension, retencion4ta, suspensionVigente } from "@/lib/retencion";
import { ItemsOrden } from "@/components/items-orden";
import { SelectorDiseno } from "@/components/selector-diseno";
import type { DisenoItems } from "@/lib/diseno";
import { Faltan } from "@/components/ui/faltan";

type Precio = { pu: string; aprobado: boolean };

export type EstadoCotizacion = {
  estado: "SIN_ENVIAR" | "ENVIADA" | "RECIBIDA";
  enviadaAt: string | null;
  recibidaAt: string | null;
  /** Veces que el proveedor abrió el link. */
  vistas: number;
};

// Botón de los bloques de acciones (Orden / Link de cotización): icono sobre el texto, 3 por fila.
const BOTON_BLOQUE = "h-16 flex-col gap-1 px-1 text-[15px]";

export function DetalleOrden({
  orden,
  items,
  comprobanteHabitual,
  detracciones = {},
  detraccionMinimo = 700,
  contactos,
  cotizacion,
  rechazos = [],
  pagos,
  comprobantes,
  entregaCerrada,
  guia,
  entregas,
  contexto,
  documentos,
  contratoFirmado,
  descuentos = { detraccion: 0, retencion: 0 },
  diseno = "lista",
  avance = {},
  faltaGuia = false,
  manoObra = false,
  requiereGuia = false,
  retencionProveedor = { pct: 8, suspension: null },
  contrato,
  historico = false,
  retenidaEn = null,
}: {
  orden: VOrden;
  items: VOcItem[];
  comprobanteHabitual: TipoComprobante | null;
  /** Ítem → % de detracción en la obra (los que la llevan). */
  detracciones?: Record<number, number>;
  /** La factura lleva detracción solo si su total supera este monto. */
  detraccionMinimo?: number;
  contactos: {
    nombre: string | null;
    telefono: string;
    whatsapp: boolean;
    telegram: boolean;
  }[];
  cotizacion: EstadoCotizacion;
  /** Rechazos de Tesorería, del más reciente al más antiguo (con las facturas que anuló cada uno). */
  rechazos?: RechazoVer[];
  /** Pagos de la orden con su voucher (constancia para el proveedor). */
  pagos: { id: number; fecha: string; banco: string | null; numero_operacion: string | null; monto: number; historico?: boolean; vouchers: { nombre: string; url: string; mime: string | null }[] }[];
  /** Comprobantes de la orden, con corrección e historial. */
  comprobantes?: React.ReactNode;
  /** Operaciones cerró la entrega aunque faltaba recibir una parte. */
  entregaCerrada: { fecha: string; motivo: string | null } | null;
  /** Guía de remisión (solo OC). */
  guia?: React.ReactNode;
  /** Entregas con fotos (orden en entrega o recibida). */
  entregas?: React.ReactNode;
  /** La orden dentro del presupuesto de la obra (obra, etapas e ítems). */
  contexto?: React.ReactNode;
  documentos: React.ReactNode;
  /** OS: ya se subió el contrato firmado (requisito para enviar a Tesorería). */
  contratoFirmado: boolean;
  /** De los comprobantes: lo que Tesorería no le paga al proveedor (detracción y retención de 4ta). */
  descuentos?: { detraccion: number; retencion: number };
  /** Diseño de los ítems (botón de la barra superior); «lista» es el de siempre y el de la edición de precios. */
  diseno?: DisenoItems;
  /** Por partida: lo ejecutado frente a lo presupuestado (para el diseño «Con avance»). */
  avance?: Record<number, { presupuestado: number; ejecutado: number; montoPresupuestado: number; montoEjecutado: number }>;
  /** OC que requiere guía y aún no la tiene registrada: prod 1, Logística la registra antes de enviar a Tesorería. */
  faltaGuia?: boolean;
  /** OS de una valorización o de la retención: el P.U. ya viene neto de retención, sin comparar con el presupuesto. */
  manoObra?: boolean;
  /** OC: si requiere guía (se puede cambiar por última vez al facturar). */
  requiereGuia?: boolean;
  /** % de retención de 4ta del proveedor y fecha de su suspensión (si tiene). */
  retencionProveedor?: { pct: number; suspension: string | null };
  /** OS: datos del contrato (comprobante elegido, fechas y quien firma por la empresa). */
  contrato?: DatosContrato;
  /** Orden cargada del Excel: no exige contrato, guía ni archivos. */
  historico?: boolean;
  /** La OS de retenciones en que se devolvió su garantía. */
  retenidaEn?: string | null;
}) {
  const pwa = useEsPwa();
  const router = useRouter();
  // Cuando el proveedor envía su cotización (u otro usuario cambia la orden) la pantalla se refresca sola.
  useCambiosOrden(orden.obra_id!, orden.numero!);
  const [token, setToken] = useState(orden.token_cotizacion);
  const [reenviar, setReenviar] = useState(false);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  // Rechazo de Tesorería aún por corregir: la orden vuelve con la nota de lo corregido.
  const rechazoAbierto = rechazos[0] && !rechazos[0].reenviado ? rechazos[0] : null;
  const [notaReenvio, setNotaReenvio] = useState("");

  // OS: el precio de referencia es el presupuestado. Al enviar, Tesorería recibe aviso de las diferencias.
  const difOS =
    orden.tipo === "OS" && !manoObra
      ? {
          sobre: items.filter((i) => Number(i.pu_efectivo) > Number(i.pu_partida) + 0.0001).length,
          bajo: items.filter((i) => Number(i.pu_efectivo) < Number(i.pu_partida) - 0.0001).length,
        }
      : null;

  const enviarTesoreria = () =>
    startTransition(async () => {
      setError(null);
      const r = rechazoAbierto
        ? await reenviarATesoreria(orden.obra_id!, orden.numero!, notaReenvio)
        : await enviarATesoreria(orden.obra_id!, orden.numero!);
      setConfirmarEnvio(false);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  // Constancia de pago al proveedor: el voucher (o el simulado si no hay archivo) por la hoja de compartir, o los datos del pago por
  // WhatsApp. Abrirlos no prueba que se envió: la orden pasa a «Enviada» (EN_ENTREGA) cuando Logística lo confirma. El mensaje nombra
  // la factura, no la orden: su N° es de control interno.
  const facturasPagadas = [...new Set(items.map((i) => i.comprobante).filter((c): c is string => !!c))].map((c) => c.replace("-", " - "));
  const textoConstancia = () =>
    [
      `${orden.empresa}: pagamos ${facturasPagadas.length ? `la ${facturasPagadas.join(", ")}` : "tu comprobante"}, obra ${orden.obra}.`,
      ...pagos.map((p) => `Operación ${p.numero_operacion ?? "—"} ${p.banco ?? ""}, ${fecha(p.fecha)}, S/ ${money(p.monto)}.`),
    ].join(" ");

  const constanciaEnviada = () =>
    startTransition(async () => {
      const r = await enviarConstancia(orden.obra_id!, orden.numero!);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  const compartirConstancia = () =>
    startTransition(async () => {
      setError(null);
      const urls = pagos.flatMap((p) =>
        p.vouchers.length ? p.vouchers.map((v) => ({ url: v.url, nombre: v.nombre })) : [{ url: `/voucher-simulado/${p.id}`, nombre: `voucher-${p.id}.png` }],
      );
      const archivos = await Promise.all(
        urls.map(async (u) => {
          const b = await (await fetch(u.url)).blob();
          return new File([b], u.nombre, { type: b.type });
        }),
      );
      const datos = { files: archivos, text: textoConstancia(), title: `Pago ${facturasPagadas.join(", ")}` };
      if (navigator.canShare?.(datos)) await navigator.share(datos).catch(() => {});
      else archivos.forEach((f) => descargar(f, f.name));
    });

  const whatsappConstancia = () => {
    const destino = contactoWa ? telefonoIntl(contactoWa.telefono) : "";
    window.open(`https://wa.me/${destino}?text=${encodeURIComponent(textoConstancia())}`, "_blank");
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [anular, setAnular] = useState(false);
  const [comprobante, setComprobante] = useState(false);
  const [confirmarPrecios, setConfirmarPrecios] = useState(false);

  const editable = orden.estado === "EMITIDA";
  const [precios, setPrecios] = useState<Map<number, Precio>>(
    () =>
      new Map(
        items.map((i) => [
          i.id,
          {
            pu: i.pu_cotizado == null ? "" : String(i.pu_cotizado),
            aprobado: i.pu_aprobado != null,
          },
        ]),
      ),
  );

  const lineas = useMemo(
    () =>
      items.map((it) => {
        if (!editable)
          return {
            it,
            pu: it.pu_bruto ?? it.pu_cotizado,
            sobre: it.alerta === "SOBREPRECIO",
            // Antes de la garantía: la línea es cantidad × P.U.; lo retenido se resta en el total.
            parcial: Number(it.parcial ?? 0) + Number(it.retenido ?? 0),
            retenido: Number(it.retenido ?? 0),
            aprobado: it.pu_aprobado != null,
          };
        const p = precios.get(it.id)!;
        const pu = p.pu === "" ? null : Number(p.pu);
        const sobre = pu != null && it.pu_max != null && pu > Number(it.pu_max);
        // Mientras se edita, el parcial usa el precio cotizado aunque el sobreprecio no esté aprobado:
        // la línea se resalta y "Confirmar precios" sigue bloqueado hasta aprobarlo.
        return {
          it,
          pu,
          sobre,
          aprobado: p.aprobado,
          parcial: pu == null ? null : pu * Number(it.cantidad),
          // Una histórica ya tiene su P.U. neto: no se descuenta otra vez.
          retenido: pu == null || it.pu_bruto != null ? 0 : retenidoDe(pu * Number(it.cantidad), Number(it.ret_garantia_pct ?? 0)),
        };
      }),
    [items, precios, editable],
  );

  const retenido = lineas.reduce((a, l) => a + l.retenido, 0);
  const total = lineas.reduce((a, l) => a + (l.parcial ?? 0), 0) - retenido;
  // Recibo de más de S/ 1,500 aún sin registrar: con la constancia a tiempo, no se le retiene.
  const avisoSuspension =
    !manoObra &&
    contrato?.comprobante === "RXH" &&
    (orden.estado === "EMITIDA" || orden.estado === "PRECIOS_CONFIRMADOS") &&
    faltaSuspension(editable ? total : Number(orden.total), retencionProveedor.suspension, hoyISO());
  const faltanPrecios = lineas.some((l) => l.pu == null);
  const sinAprobar = lineas.filter((l) => l.sobre && !l.aprobado).length;
  const sinComprobante = items.filter((i) => i.comprobante_id == null);
  const puedeAnular =
    (orden.estado === "EMITIDA" || orden.estado === "PRECIOS_CONFIRMADOS") &&
    items.every((i) => i.comprobante_id == null);

  const setPu = (id: number, patch: Partial<Precio>) =>
    setPrecios((prev) => new Map(prev).set(id, { ...prev.get(id)!, ...patch }));

  const guardar = (confirmar: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await guardarPrecios({
        obraId: orden.obra_id,
        numero: orden.numero,
        confirmar,
        precios: lineas.map((l) => ({
          item_id: l.it.id,
          pu: l.pu,
          pu_aprobado: l.sobre && l.aprobado ? l.pu : null,
        })),
      });
      setConfirmarPrecios(false);
      if (!res.ok) return setError(res.error);
      setAviso(confirmar ? null : "Guardado");
      router.refresh();
    });

  const linkCotizacion = () => `${window.location.origin}/cotizar/${token}`;

  // Compartir el link lo deja como "enviado" (sin esperar: la ventana de WhatsApp/Telegram se abre ya).
  const marcarEnviada = () => {
    if (cotizacion.estado === "SIN_ENVIAR") {
      void marcarCotizacionEnviada(orden.obra_id!, orden.numero!).then(() => router.refresh());
    }
  };

  const confirmarReenvio = () =>
    startTransition(async () => {
      setError(null);
      const res = await reenviarCotizacion(orden.obra_id!, orden.numero!);
      setReenviar(false);
      if (!res.ok) return setError(res.error);
      setToken(res.data);
      setAviso("Link nuevo listo: compártelo");
      router.refresh();
    });

  const generarPdf = async () => {
    const { ordenPdfBlob } = await import("@/lib/pdf/orden-pdf");
    const blob = await ordenPdfBlob(orden, items);
    const nombre = `${orden.tipo}-${orden.numero}-${orden.obra}.pdf`.replace(
      /\s+/g,
      "_",
    );
    return { blob, nombre };
  };

  const descargar = (blob: Blob, nombre: string) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: nombre,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const compartirPdf = () =>
    startTransition(async () => {
      const { blob, nombre } = await generarPdf();
      const file = new File([blob], nombre, { type: "application/pdf" });
      // Sin soporte para compartir archivos (p. ej. escritorio) se descarga.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator
          .share({ files: [file], title: `${orden.tipo} ${orden.numero}` })
          .catch(() => {});
      } else descargar(blob, nombre);
    });

  const descargarPdf = () =>
    startTransition(async () => {
      const { blob, nombre } = await generarPdf();
      descargar(blob, nombre);
    });

  const verPdf = () => {
    // La pestaña se abre antes de generar el PDF para que el navegador no la bloquee. En la PWA
    // no hay pestañas: se descarga y lo abre el visor de PDF del teléfono.
    const ventana = pwa ? null : window.open("", "_blank");
    startTransition(async () => {
      const { blob, nombre } = await generarPdf();
      abrirBlob(blob, nombre, pwa, ventana);
    });
  };

  // Contactos del proveedor: WhatsApp abre su chat con el mensaje listo; Telegram, su chat (el link queda copiado).
  const contactoWa = contactos.find((c) => c.whatsapp);
  const contactoTg = contactos.find((c) => c.telegram);

  const whatsapp = () => {
    const texto = `${orden.empresa}: link para cotizar la ${orden.tipo} ${orden.numero}, obra ${orden.obra}.\n${linkCotizacion()}`;
    const destino = contactoWa ? telefonoIntl(contactoWa.telefono) : "";
    marcarEnviada();
    window.open(
      `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`,
      "_blank",
    );
  };

  const telegram = async () => {
    await navigator.clipboard.writeText(linkCotizacion()).catch(() => {});
    marcarEnviada();
    setAviso("Link copiado: pégalo en el chat");
    window.open(
      `https://t.me/+${telefonoIntl(contactoTg!.telefono)}`,
      "_blank",
    );
  };

  const copiarLink = async () => {
    await navigator.clipboard.writeText(linkCotizacion());
    marcarEnviada();
    setAviso("Link copiado");
  };

  return (
    <>
      <TopBar
        title={`${orden.tipo} ${orden.numero}`}
        back={`/logistica?tipo=${orden.tipo}`}
        right={
          <>
            <SelectorDiseno pantalla="orden-logistica" tipo="items" actual={diseno} />
            {puedeAnular && (
              <button
                type="button"
                aria-label="Más opciones"
                onClick={() => setMenu(true)}
                className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
              >
                <MoreVertical size={22} />
              </button>
            )}
          </>
        }
      />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3">
        <section className="rounded-panel bg-surface p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-ink-3">Obra</dt>
            <dd>{orden.obra}</dd>
            <dt className="text-ink-3">Empresa</dt>
            <dd>{orden.empresa}</dd>
            <dt className="text-ink-3">Proveedor</dt>
            <dd>{orden.proveedor}</dd>
            <dt className="text-ink-3">Fecha</dt>
            <dd className="num">{fecha(orden.fecha)}</dd>
            <dt className="text-ink-3">Estado</dt>
            <dd className={cn((orden.estado === "ANULADA" || rechazoAbierto) && "font-semibold text-danger")}>
              {rechazoAbierto && orden.estado !== "ANULADA" ? "Rechazada, por corregir" : ESTADO_LABEL[orden.estado]}
            </dd>
            {historico && (
              <>
                <dt className="text-ink-3">Origen</dt>
                <dd>Histórico (Excel)</dd>
              </>
            )}
            {orden.estado === "ANULADA" && orden.motivo_anulacion && (
              <>
                <dt className="text-ink-3">Motivo</dt>
                <dd>{orden.motivo_anulacion}</dd>
              </>
            )}
          </dl>
        </section>

        {avisoSuspension && (
          <section className="rounded-panel bg-warn-bg p-4">
            <p className="font-semibold text-warn">Sin suspensión de 4ta: pídele la constancia al proveedor</p>
          </section>
        )}
        {rechazoAbierto && orden.estado !== "ANULADA" && (
          <section role="alert" aria-label="Rechazo de Tesorería" className="rounded-panel bg-danger-bg p-4 text-danger">
            <p className="font-semibold">
              Rechazada por Tesorería el {fecha(rechazoAbierto.fecha)}
              {rechazoAbierto.por && ` (${rechazoAbierto.por})`}: {CORRECCION_TAREA[rechazoAbierto.correccion ?? "PRECIOS"]}
            </p>
            {rechazoAbierto.motivo && <p className="mt-1 text-ink">{rechazoAbierto.motivo}</p>}
            {rechazoAbierto.anuladas.length > 0 && <p className="mt-1 text-ink">Anulada: {rechazoAbierto.anuladas.join(", ")}</p>}
          </section>
        )}

        {pagos.length > 0 && (
          <Plegable
            titulo={orden.estado === "PAGADA" ? "Constancia de pago" : "Pago"}
            resumen={soles(pagos.reduce((a, p) => a + p.monto, 0))}
            abierto={orden.estado === "PAGADA"}
          >
            {pagos.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <p className="num flex flex-wrap gap-x-3 px-1 text-[15px] text-ink-2">
                  <span>Op. {p.numero_operacion ?? "—"}</span>
                  <span>{p.banco}</span>
                  <span>{fecha(p.fecha)}</span>
                  <span className="font-semibold text-ink">{soles(p.monto)}</span>
                </p>
                {p.vouchers.length ? (
                  p.vouchers.map((v) => <Voucher key={v.url} pagoId={p.id} archivo={v} />)
                ) : (
                  <Voucher pagoId={p.id} historico={p.historico} />
                )}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={whatsappConstancia} disabled={pending} className={BOTON_BLOQUE}>
                <IconoWhatsApp size={20} /> WhatsApp
              </Button>
              <Button variant="secondary" onClick={compartirConstancia} disabled={pending} className={BOTON_BLOQUE}>
                <Share2 size={20} /> Compartir
              </Button>
            </div>
            {orden.estado === "PAGADA" && (
              <Button onClick={constanciaEnviada} disabled={pending}>
                <Check size={18} /> Confirmar envío
              </Button>
            )}
          </Plegable>
        )}

        {rechazos.length > 0 && (
          <Plegable titulo={`Rechazos (${rechazos.length})`}>
            <HistorialRechazos rechazos={rechazos} />
          </Plegable>
        )}

        {(editable || orden.estado !== "ANULADA") && (
          <section className="rounded-panel bg-surface p-3">
            <h2 className="rotulo px-1 pb-2 text-[17px] font-semibold">
              {orden.tipo === "OC" ? "Orden de compra" : "Orden de servicio"}
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                onClick={compartirPdf}
                disabled={pending}
                className={BOTON_BLOQUE}
              >
                <Share2 size={20} /> Compartir
              </Button>
              <Button
                variant="secondary"
                onClick={verPdf}
                disabled={pending}
                className={BOTON_BLOQUE}
              >
                <Eye size={20} /> Ver
              </Button>
              <Button
                variant="secondary"
                onClick={descargarPdf}
                disabled={pending}
                className={BOTON_BLOQUE}
              >
                <Download size={20} /> Descargar
              </Button>
            </div>
          </section>
        )}
        {editable && (
          <section className="rounded-panel bg-surface p-3">
            <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
              <h2 className="rotulo text-[17px] font-semibold">Link de cotización</h2>
              <span className={cn("text-right text-[14px]", cotizacion.estado === "RECIBIDA" ? "font-semibold text-ok" : "text-ink-2")}>
                {textoCotizacion(cotizacion)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" onClick={whatsapp} className={BOTON_BLOQUE}>
                <IconoWhatsApp size={20} /> WhatsApp
              </Button>
              <Button
                variant="secondary"
                onClick={telegram}
                disabled={!contactoTg}
                aria-label={contactoTg ? "Telegram" : "Telegram (el proveedor no tiene Telegram registrado)"}
                className={BOTON_BLOQUE}
              >
                <Send size={20} /> Telegram
              </Button>
              <Button variant="secondary" onClick={copiarLink} className={BOTON_BLOQUE}>
                <Link2 size={20} /> Copiar
              </Button>
              {cotizacion.estado === "RECIBIDA" && (
                <Button variant="secondary" onClick={() => setReenviar(true)} disabled={pending} className="col-span-3">
                  <RotateCcw size={18} /> Reenviar para corregir
                </Button>
              )}
            </div>
          </section>
        )}

        {/* Mientras se editan los precios, siempre la lista de siempre (tiene los campos de P.U.). */}
        {!editable && diseno !== "lista" && (
          <ItemsOrden
            diseno={diseno}
            items={lineas.map(({ it, pu, sobre, aprobado, parcial }) => ({
              id: it.id!,
              descripcion: it.descripcion ?? "",
              unidad: it.unidad ?? "",
              etapa: it.etapa ?? null,
              cantidad: Number(it.cantidad),
              pu,
              parcial: Number(parcial ?? 0),
              puPresupuesto: manoObra ? null : it.pu_partida,
              puMax: manoObra ? null : it.pu_max,
              puUltimo: manoObra ? null : it.pu_hist,
              alerta: sobre && !aprobado,
              comprobante: it.comprobante,
              requerimiento: it.requerimiento,
              ...avance[it.partida_id!],
            }))}
          />
        )}
        {(editable || diseno === "lista") && (
        <Lista
          columnas="grid-cols-[1fr_7rem_1fr]"
          encabezado={[
            <Pila key="d">{["Descripción", "Cantidad"]}</Pila>,
            "P.U.",
            "Parcial",
          ]}
        >
          {lineas.map(({ it, pu, sobre, aprobado, parcial }) => (
            <li
              key={it.id}
              className={cn(
                "border-b border-line px-4 py-3 last:border-0",
                sobre && !aprobado && "bg-warn-bg",
              )}
            >
              <div className="leading-snug">
                {it.descripcion} <MarcaAdicional requerimiento={it.requerimiento} />
              </div>
              <div className="mt-2 grid grid-cols-[1fr_7rem_1fr] items-center gap-2">
                <div className="num text-sm">
                  {qty(it.cantidad)}{" "}
                  <span className="text-ink-3">{it.unidad}</span>
                </div>
                {editable ? (
                  <NumberInput
                    aria-label={`P.U. ${it.descripcion}`}
                    placeholder="P.U."
                    value={precios.get(it.id)!.pu}
                    onChange={(e) =>
                      setPu(it.id, { pu: e.target.value, aprobado: false })
                    }
                    className={cn("h-11", sobre && !aprobado && "border-warn")}
                  />
                ) : (
                  <div className="num text-right">{solesPu(pu)}</div>
                )}
                <div
                  className={cn(
                    "num text-right font-medium",
                    sobre && !aprobado && "text-warn",
                  )}
                >
                  {soles(parcial)}
                </div>
              </div>
              {!manoObra && (
              <dl className="num mt-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-x-2 rounded-field bg-sunken px-2.5 py-1.5 text-[13px]">
                <div>
                  <dt className="text-ink-3">Presupuesto</dt>
                  <dd>{soles(it.pu_partida)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Máximo</dt>
                  <dd>{soles(it.pu_max)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Histórico</dt>
                  <dd>{soles(it.pu_hist)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Diferencia</dt>
                  {pu != null && it.pu_partida != null ? (
                    <dd
                      className={cn(
                        "-mx-1 rounded-[5px] px-1",
                        CLASE_TONO[
                          tonoPrecio(pu, Number(it.pu_partida), it.pu_max)
                        ],
                      )}
                    >
                      {/* Solo se parte entre el monto y el porcentaje. */}
                      {textoDiferencia(pu, Number(it.pu_partida)).replace(" %", "\u00a0%")}
                    </dd>
                  ) : (
                    <dd>—</dd>
                  )}
                </div>
              </dl>
              )}
              {it.comprobante && (
                <p className="mt-1.5 text-[13px] text-ink-2">
                  Comprobante{" "}
                  <span className="num font-medium text-ink">
                    {it.comprobante}
                  </span>
                </p>
              )}
              {editable && sobre && (
                <label className="mt-2 flex h-11 items-center gap-3 text-sm font-medium text-warn">
                  <input
                    type="checkbox"
                    checked={aprobado}
                    onChange={(e) =>
                      setPu(it.id, { aprobado: e.target.checked })
                    }
                    className="h-5 w-5"
                  />
                  Aprobar sobreprecio
                </label>
              )}
            </li>
          ))}
        </Lista>
        )}

        <section className="num flex flex-col gap-1 rounded-panel bg-surface p-4">
          {retenido > 0.005 && (
            <>
              <div className="flex justify-between text-ink-2">
                <span>Subtotal</span>
                <span>{soles((editable ? total : Number(orden.total)) + retenido)}</span>
              </div>
              <div className="flex justify-between text-ink-2">
                <span>Retención por garantía</span>
                <span>− {soles(retenido)}</span>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">Total</span>
            <span className="rotulo text-[30px] font-semibold leading-none">
              {soles(editable ? total : orden.total)}
            </span>
          </div>
          {!editable && (orden.facturado ?? 0) > 0 && (
            <div className="flex justify-between text-ink-2">
              <span>Facturado</span>
              <span>{soles(orden.facturado)}</span>
            </div>
          )}
          {!editable && descuentos.detraccion > 0.005 && (
            <div className="flex justify-between text-ink-2">
              <span>Detracción</span>
              <span>− {soles(descuentos.detraccion)}</span>
            </div>
          )}
          {!editable && descuentos.retencion > 0.005 && (
            <div className="flex justify-between text-ink-2">
              <span>Retención 4ta</span>
              <span>− {soles(descuentos.retencion)}</span>
            </div>
          )}
          {!editable && (orden.pagado ?? 0) > 0 && (
            <div className="flex justify-between text-ink-2">
              <span>Pagado</span>
              <span>{soles(orden.pagado)}</span>
            </div>
          )}
          {retenidaEn && (
            <div className="flex items-center justify-between text-ink-2">
              <span>Garantía</span>
              <Link
                href={`/logistica/ordenes/${orden.obra_id}/${encodeURIComponent(retenidaEn)}?tipo=OS`}
                className="flex min-h-11 items-center pl-3 font-medium text-primary"
              >
                OS {retenidaEn}
              </Link>
            </div>
          )}
        </section>

        {comprobantes}
        {entregaCerrada && (
          <section className="rounded-panel bg-warn-bg p-4">
            <p className="font-semibold text-warn">Entrega cerrada incompleta el {fecha(entregaCerrada.fecha)}</p>
            {entregaCerrada.motivo && <p className="mt-1">{entregaCerrada.motivo}</p>}
          </section>
        )}
        {guia}
        {contexto}
        {entregas}
        {/* La OS histórica no lleva el contrato de prod 1: solo sus documentos (el firmado es opcional). */}
        {orden.tipo === "OS" && historico && orden.estado !== "ANULADA" ? (
          documentos
        ) : orden.tipo === "OS" && orden.estado !== "EMITIDA" && orden.estado !== "ANULADA" ? (
          <ContratoOS orden={orden} items={items} contactos={contactos} firmado={contratoFirmado} documentos={documentos} datos={contrato} />
        ) : (
          orden.estado === "ANULADA" && documentos
        )}

        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-ok">
            {aviso}
          </p>
        )}
      </main>

      {editable && (
        <ActionBar
          arriba={
            <Faltan
              items={[
                faltanPrecios && "precios",
                sinAprobar > 0 && `aprobar ${sinAprobar === 1 ? "1 sobreprecio" : `${sinAprobar} sobreprecios`}`,
              ]}
            />
          }
        >
          <Button
            variant="secondary"
            onClick={() => guardar(false)}
            disabled={pending}
          >
            Guardar
          </Button>
          <Button
            className="flex-1"
            onClick={() => setConfirmarPrecios(true)}
            disabled={pending || faltanPrecios || sinAprobar > 0}
          >
            <Check size={18} /> Confirmar precios
          </Button>
        </ActionBar>
      )}
      {!editable &&
        (orden.estado === "PRECIOS_CONFIRMADOS" ||
          orden.estado === "FACTURADA") &&
        sinComprobante.length > 0 && (
          <ActionBar>
            <Button className="flex-1" onClick={() => setComprobante(true)}>
              <Paperclip size={18} /> Registrar comprobante
            </Button>
          </ActionBar>
        )}
      {orden.estado === "FACTURADA" && sinComprobante.length === 0 && (
        <ActionBar>
          {orden.tipo === "OS" && !contratoFirmado ? (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => document.getElementById("contrato")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Falta el contrato firmado
            </Button>
          ) : faltaGuia ? (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => document.getElementById("guia")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Falta la guía de remisión
            </Button>
          ) : (
            <Button className="flex-1" onClick={() => setConfirmarEnvio(true)} disabled={pending}>
              <Send size={18} /> {rechazoAbierto ? "Reenviar a Tesorería" : "Enviar a Tesorería"}
            </Button>
          )}
        </ActionBar>
      )}
      <Confirm
        open={confirmarEnvio}
        title={rechazoAbierto ? "¿Reenviar a Tesorería?" : "¿Enviar a Tesorería?"}
        onYes={enviarTesoreria}
        onNo={() => setConfirmarEnvio(false)}
        pending={pending}
      >
        <p className="rotulo text-[34px] font-semibold leading-none">S/ {money(orden.total)}</p>
        {rechazoAbierto && (
          <Field label="Qué se corrigió">
            <textarea
              value={notaReenvio}
              onChange={(e) => setNotaReenvio(e.target.value)}
              rows={3}
              aria-label="Qué se corrigió"
              className={cn(inputClass, "h-auto py-3")}
            />
          </Field>
        )}
        {difOS && difOS.sobre > 0 && (
          <p className="font-semibold text-danger">
            {difOS.sobre} {difOS.sobre === 1 ? "precio sobre" : "precios sobre"} el presupuesto
          </p>
        )}
        {difOS && difOS.bajo > 0 && (
          <p className="font-semibold text-ok">
            {difOS.bajo} {difOS.bajo === 1 ? "precio por debajo" : "precios por debajo"} del presupuesto
          </p>
        )}
      </Confirm>

      <Confirm
        open={reenviar}
        title="¿Reenviar el link?"
        onYes={confirmarReenvio}
        onNo={() => setReenviar(false)}
        pending={pending}
      >
        <p className="text-ink-2">El link anterior deja de funcionar.</p>
      </Confirm>
      <Confirm
        open={confirmarPrecios}
        title="¿Confirmar precios?"
        onYes={() => guardar(true)}
        onNo={() => setConfirmarPrecios(false)}
        pending={pending}
      >
        <p className="rotulo text-[34px] font-semibold leading-none">
          S/ {money(total)}
        </p>
      </Confirm>

      <Sheet
        open={menu}
        onClose={() => setMenu(false)}
        title={`${orden.tipo} ${orden.numero}`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setAnular(true);
            }}
            className="flex h-12 w-full items-center rounded-control px-3 text-danger active:bg-ink/8"
          >
            Anular orden
          </button>
        </div>
      </Sheet>

      <AnularSheet
        open={anular}
        onClose={() => setAnular(false)}
        orden={orden}
      />
      {comprobante && (
        <ComprobanteSheet
          onClose={() => setComprobante(false)}
          orden={orden}
          items={sinComprobante}
          tipoHabitual={orden.tipo === "OS" ? (contrato?.comprobante ?? comprobanteHabitual) : comprobanteHabitual}
          detracciones={detracciones}
          detraccionMinimo={detraccionMinimo}
          requiereGuia={requiereGuia}
          retencionProveedor={retencionProveedor}
          comprobanteOS={orden.tipo === "OS" ? (contrato?.comprobante ?? null) : null}
          guiaRegistrada={(requiereGuia && !faltaGuia) || historico}
          contratoFirmado={contratoFirmado || historico}
          historico={historico}
        />
      )}
    </>
  );
}

function AnularSheet({
  open,
  onClose,
  orden,
}: {
  open: boolean;
  onClose: () => void;
  orden: VOrden;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Anular ${orden.tipo} ${orden.numero}`}
      footer={
        <div className="flex flex-col gap-2">
        <Faltan items={[!motivo.trim() && "motivo"]} />
        <Button
          variant="danger"
          size="lg"
          disabled={pending || !motivo.trim()}
          onClick={() =>
            startTransition(async () => {
              const res = await anularOrden(
                orden.obra_id,
                orden.numero,
                motivo,
              );
              if (!res.ok) return setError(res.error);
              onClose();
              router.refresh();
            })
          }
        >
          Anular
        </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <Field label="Motivo">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className={cn(inputClass, "h-auto py-3")}
          />
        </Field>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function ComprobanteSheet({
  onClose,
  orden,
  items,
  tipoHabitual,
  detracciones,
  detraccionMinimo,
  requiereGuia: requiereInicial,
  retencionProveedor,
  comprobanteOS,
  guiaRegistrada,
  contratoFirmado,
  historico,
}: {
  onClose: () => void;
  orden: VOrden;
  items: VOcItem[];
  tipoHabitual: TipoComprobante | null;
  detracciones: Record<number, number>;
  detraccionMinimo: number;
  requiereGuia: boolean;
  retencionProveedor: { pct: number; suspension: string | null };
  /** OS: comprobante elegido al crearla (si llega el otro, el contrato se regenera). */
  comprobanteOS: "RXH" | "FACTURA" | null;
  /** Lo que la orden ya tiene: con la factura de todas sus líneas va sola a Tesorería. */
  guiaRegistrada: boolean;
  contratoFirmado: boolean;
  /** Orden del Excel: el archivo del comprobante es opcional (en las demás es obligatorio). */
  historico: boolean;
}) {
  const router = useRouter();
  // Tipo inicial: el habitual del proveedor; si no tiene, el último elegido (se recuerda por separado
  // para OC y OS); si no hay, factura en OC y recibo por honorarios en OS.
  const clavePreferencia = `comprobante-tipo:${orden.tipo}`;
  const [tipo, setTipo] = useState<TipoComprobante>(
    () => tipoHabitual ?? leer<TipoComprobante>(clavePreferencia) ?? (orden.tipo === "OS" ? "RXH" : "FACTURA"),
  );
  // OC: última decisión sobre la guía. Sin guía, al quedar facturada pasa directo a Tesorería.
  const [requiereGuia, setRequiereGuia] = useState(requiereInicial);
  const regenera = comprobanteOS != null && (tipo === "RXH" || tipo === "FACTURA") && tipo !== comprobanteOS;
  const [serie, setSerie] = useState("");
  const [numero, setNumero] = useState("");
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [sel, setSel] = useState<Set<number>>(
    () => new Set(items.map((i) => i.id)),
  );
  const sugerido = items
    .filter((i) => sel.has(i.id))
    .reduce((a, i) => a + Number(i.parcial ?? 0), 0);
  const [total, setTotal] = useState<string>("");
  const totalNum = total === "" ? sugerido : Number(total);
  // Retención de 4ta: RHE de más de S/ 1,500, por el % del proveedor, salvo suspensión vigente. La calcula (y la exige)
  // la base: aquí solo se muestra.
  const suspendida = tipo === "RXH" && suspensionVigente(retencionProveedor.suspension, fechaEmision);
  const retencionNum = tipo === "RXH" ? retencion4ta(totalNum, fechaEmision, retencionProveedor) : 0;
  // Detracción de una factura: total × (Σ parcial × % ÷ Σ parcial) de las líneas elegidas que la llevan.
  const elegidas = items.filter((i) => sel.has(i.id));
  const conDetraccion =
    tipo === "FACTURA" && totalNum > detraccionMinimo && elegidas.some((i) => (detracciones[i.item_id ?? -1] ?? 0) > 0);
  const sumaParcial = elegidas.reduce((a, i) => a + Number(i.parcial ?? 0), 0);
  const detraccionSugerida =
    conDetraccion && sumaParcial > 0
      ? Math.round(
          ((totalNum * elegidas.reduce((a, i) => a + Number(i.parcial ?? 0) * (detracciones[i.item_id ?? -1] ?? 0), 0)) / 100 / sumaParcial) * 100,
        ) / 100
      : 0;
  // Con retención por garantía se factura el neto (la base rechaza otro total).
  const netoMal = items.some((i) => sel.has(i.id!) && Number(i.retenido) > 0) && Math.round(Math.abs(totalNum - sugerido) * 100) > 100;
  const [detraccion, setDetraccion] = useState<string>("");
  const detraccionNum = conDetraccion ? (detraccion === "" ? detraccionSugerida : Number(detraccion)) : 0;
  const [archivo, setArchivo] = useState<File | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Un error del servidor deja de valer en cuanto se corrige un dato.
  const con =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setError(null);
      set(v);
    };

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      // Antes de subir el archivo: si no, cada intento rechazado deja un archivo suelto en el storage.
      if (!serieValida(tipo, serie)) return setError(SERIE_INVALIDA);
      const supabase = createClient();
      let archivoPath: string | null = null;
      if (archivo) {
        const ext = archivo.name.split(".").pop()?.toLowerCase() ?? "pdf";
        archivoPath = `${orden.empresa_id}/${orden.proveedor_ruc}/${serie}-${numero}-${Date.now()}.${ext}`;
        const { error: up } = await supabase.storage.from("comprobantes").upload(archivoPath, archivo);
        if (up) return setError(up.message);
      }
      const res = await registrarComprobante({
        obraId: orden.obra_id,
        numero: orden.numero,
        proveedorId: orden.proveedor_id,
        tipo,
        serie,
        numeroComprobante: numero,
        fecha: fechaEmision,
        total: totalNum,
        retencion: retencionNum,
        detraccion: conDetraccion ? detraccionNum : null,
        archivoPath,
        itemIds: [...sel],
        ...(orden.tipo === "OC" ? { requiereGuia } : {}),
      });
      if (!res.ok) {
        if (archivoPath) await supabase.storage.from("comprobantes").remove([archivoPath]);
        return setError(res.error);
      }
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Comprobante"
      full
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <Faltan
            items={[
              !serie && "serie",
              !numero && "número",
              sel.size === 0 && "ítems",
              !(totalNum > 0) && "total",
              !archivo && !historico && "archivo de la factura",
              netoMal && `total de ${soles(sugerido)}, sin la retención por garantía`,
            ]}
          />
          <Button
            size="lg"
            onClick={guardar}
            disabled={
              pending || !serie || !numero || sel.size === 0 || !(totalNum > 0) || (!archivo && !historico) || netoMal
            }
          >
            {sel.size === items.length && (orden.tipo === "OC" ? !requiereGuia || guiaRegistrada : contratoFirmado && !regenera)
              ? "Registrar y enviar a Tesorería"
              : "Registrar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Tipo">
          <SearchSelect
            label="Tipo de comprobante"
            value={tipo}
            onChange={(v) => {
              con(setTipo)(v as TipoComprobante);
              recordar(clavePreferencia, v);
            }}
            options={Object.entries(TIPO_COMPROBANTE_LABEL).map(
              ([value, label]) => ({ value, label }),
            )}
          />
        </Field>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <Field label="Serie">
            <Input
              value={serie}
              onChange={(e) => con(setSerie)(e.target.value.toUpperCase())}
              maxLength={10}
            />
          </Field>
          <Field label="Número">
            <Input
              value={numero}
              onChange={(e) => con(setNumero)(e.target.value.toUpperCase())}
              maxLength={20}
              inputMode="numeric"
              autoCapitalize="characters"
              autoComplete="off"
              className="num"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha emisión">
            <Input
              type="date"
              value={fechaEmision}
              onChange={(e) => con(setFechaEmision)(e.target.value)}
            />
          </Field>
          <Field label="Total">
            <NumberInput
              value={total}
              placeholder={money(sugerido)}
              onChange={(e) => con(setTotal)(e.target.value)}
            />
          </Field>
        </div>
        {conDetraccion && (
          <Field label="Detracción">
            <NumberInput
              value={detraccion}
              placeholder={money(detraccionSugerida)}
              onChange={(e) => con(setDetraccion)(e.target.value)}
            />
          </Field>
        )}
        {tipo === "RXH" && (
          <Field label={suspendida ? `Retención 4ta · suspendida ${retencionProveedor.suspension!.slice(0, 4)}` : `Retención 4ta (${retencionProveedor.pct} %)`}>
            <Input value={soles(retencionNum)} readOnly tabIndex={-1} className="num bg-ink/5 text-right text-ink-2" />
          </Field>
        )}
        {regenera && (
          <p className="rounded-field bg-warn-bg px-3 py-2 font-semibold text-warn">
            {tipo === "FACTURA" ? "Con factura, el contrato pasa a ser comercial" : "Con recibo por honorarios, el contrato pasa a ser de locación"}: hay que enviarlo y firmarlo de nuevo
          </p>
        )}
        {orden.tipo === "OC" && (
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-field border border-line px-3">
            <span>Requiere guía de remisión</span>
            <input
              type="checkbox"
              checked={requiereGuia}
              onChange={(e) => con(setRequiereGuia)(e.target.checked)}
              className="h-6 w-6 shrink-0 accent-primary"
            />
          </label>
        )}
        <input
          ref={archivoRef}
          type="file"
          hidden
          accept="application/pdf,text/xml,image/*"
          onChange={(e) => con(setArchivo)(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          className={cn(inputClass, "flex items-center gap-2 text-left", archivo ? "text-ink" : "text-ink-3")}
        >
          {archivo ? <Check size={18} className="shrink-0 text-ok" /> : <Paperclip size={18} className="shrink-0" />}
          <span className="truncate">{archivo ? archivo.name : historico ? "Subir archivo (opcional)" : "Subir archivo"}</span>
        </button>

        <ul className="overflow-hidden rounded-panel border border-line">
          {items.map((i) => (
            <li key={i.id} className="border-b border-line last:border-0">
              <label className="flex min-h-12 items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={sel.has(i.id)}
                  onChange={() =>
                    setSel((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.id)) next.delete(i.id);
                      else next.add(i.id);
                      return next;
                    })
                  }
                  className="h-5 w-5 shrink-0"
                />
                <span className="min-w-0 flex-1 leading-snug">
                  {i.descripcion}
                </span>
                <span className="num shrink-0">{soles(i.parcial)}</span>
              </label>
            </li>
          ))}
        </ul>
        {Math.abs(totalNum - sugerido) > 0.01 && (
          <p className="num text-sm text-warn">
            Diferencia con las líneas: {soles(totalNum - sugerido)}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function textoCotizacion(c: EstadoCotizacion) {
  if (c.estado === "RECIBIDA") return `Recibida ${fecha(c.recibidaAt)}`;
  if (c.estado === "SIN_ENVIAR") return "Sin enviar";
  const vistas = c.vistas ? `, abierta ${c.vistas} ${c.vistas === 1 ? "vez" : "veces"}` : "";
  return `Enviada ${fecha(c.enviadaAt)}${vistas}`;
}
