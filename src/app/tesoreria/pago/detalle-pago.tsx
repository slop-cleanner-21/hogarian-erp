"use client";

import { MarcaAdicional } from "@/components/marca-adicional";
import { Camera, Check, ChevronDown, ExternalLink, FileText } from "lucide-react";
import { CORRECCION_LABEL, HistorialRechazos, type Correccion, type RechazoVer } from "@/components/historial-rechazos";
import { Plegable } from "@/components/plegable";
import { OrdenesPartida } from "@/components/presupuesto-obra";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { Lista, Pila } from "@/components/lista";
import { subirArchivos } from "@/components/documentos";
import { TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { ComprobanteArchivo, Voucher } from "@/components/voucher";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, hoyISO, money, qty, soles, solesPu } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { VOcItem, VOrden } from "@/lib/types";
import { CLASE_TONO, textoDiferencia, tonoPrecio } from "@/lib/precio";
import { pagarDocumento, rechazarDocumento } from "../actions";
import { EnlaceArchivo, abrirBlob, useEsPwa } from "@/components/visor";
import { BotonCopiar, Dato } from "@/components/copiar";
import { ItemsOrden } from "@/components/items-orden";
import { SelectorDiseno } from "@/components/selector-diseno";
import type { DisenoItems, PantallaDiseno } from "@/lib/diseno";

const BANCOS = ["BBVA", "BCP", "INTERBANK", "SCOTIABANK", "BANCO DE LA NACION", "EFECTIVO"];

export type LineaPago = {
  id: number;
  descripcion: string;
  unidad: string;
  cantidad: number;
  pu: number | null;
  parcial: number | null;
  puMin: number | null;
  puMax: number | null;
  puUltimo: number | null;
  /** Partida del presupuesto: lo ejecutado (comprado en órdenes no anuladas) frente a lo presupuestado. */
  partidaId?: number;
  presupuestado?: number;
  ejecutado?: number;
  /** Lo mismo en soles: comprado en órdenes no anuladas frente al parcial presupuestado. */
  montoPresupuestado?: number;
  montoEjecutado?: number;
  /** OS: precio presupuestado (referencia sin tolerancia). */
  puPresupuesto?: number | null;
  etapa?: string | null;
  /** REGULAR o «ADIC n» (las adicionales llevan su marca). */
  requerimiento?: string | null;
};

export type EnlaceVer = { label: string; url: string };
export type ComprobanteVer = {
  id: number;
  etiqueta: string;
  fechaEmision: string | null;
  total: number;
  /** Lo que no se le paga al proveedor: retención de 4ta (RxH) y detracción (la paga Contabilidad). */
  retencion?: number;
  detraccion?: number;
  archivo: { url: string; nombre: string; mime: string | null } | null;
  /** Cargado del Excel: puede no tener archivo. */
  historico?: boolean;
};
export type PagoHecho = {
  id: number;
  fecha: string;
  banco: string | null;
  numero_operacion: string | null;
  monto: number;
  historico?: boolean;
  vouchers: { nombre: string; url: string; mime: string | null }[];
};

type Destino = { obraId: number; numero: string; ordenPagoId: null } | { obraId: null; numero: null; ordenPagoId: number };

export function DetallePago({
  titulo,
  datos,
  lineas,
  diseno = "lista",
  comprobantes = [],
  enlaces,
  pdfOrden,
  total,
  garantia = 0,
  pagado,
  saldo,
  pagos,
  destino,
  bancoDefault,
  carpetaVoucher,
  rechazos = [],
  sinAnular = null,
  volverA = "/tesoreria",
  pantallaDiseno = "orden-tesoreria",
  entregas,
  contexto,
  bloqueo = null,
}: {
  titulo: string;
  /** Etiqueta, valor y si se puede copiar (datos para hacer la transferencia). */
  datos: [string, string, boolean?][];
  lineas: LineaPago[];
  /** Diseño de los ítems (botón de la barra superior); «lista» es el de siempre. */
  diseno?: DisenoItems;
  comprobantes?: ComprobanteVer[];
  enlaces: EnlaceVer[];
  pdfOrden?: { orden: VOrden; items: VOcItem[] };
  total: number;
  /** Lo retenido por garantía: ya está descontado del total. */
  garantia?: number;
  pagado: number;
  saldo: number;
  pagos: PagoHecho[];
  destino: Destino;
  bancoDefault: string | null;
  carpetaVoucher: string;
  /** Motivo por el que aún no se puede aprobar el pago (p. ej. falta la guía). */
  bloqueo?: string | null;
  /** Entregas con fotos de la orden (solo lectura). */
  entregas?: React.ReactNode;
  /** La orden dentro del presupuesto de la obra (obra, etapas e ítems). */
  contexto?: React.ReactNode;
  /** Historial de rechazos de Tesorería de este documento. */
  rechazos?: RechazoVer[];
  /** Por qué la factura no se puede anular al rechazar (pagos, asiento, otra orden). */
  sinAnular?: string | null;
  /** Adónde lleva «Volver» (la bandeja de pagos o el presupuesto de obra). */
  volverA?: string | true;
  /** Pantalla con la que se recuerda el diseño de los ítems (pago de Tesorería o consulta). */
  pantallaDiseno?: PantallaDiseno;
}) {
  const pwa = useEsPwa();
  const router = useRouter();
  const pendiente = saldo > 0.005;
  // Lo que no se le paga al proveedor (lo retiene o lo deposita aparte): de los comprobantes.
  const detraccion = comprobantes.reduce((a, c) => a + Number(c.detraccion ?? 0), 0);
  const retencion = comprobantes.reduce((a, c) => a + Number(c.retencion ?? 0), 0);
  const descuentos = detraccion + retencion;
  // Prod 1: Tesorería paga siempre la orden completa (todo el saldo); no hay pagos parciales.
  const monto = saldo.toFixed(2);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [banco, setBanco] = useState<string | null>(bancoDefault?.trim() || null);
  const [operacion, setOperacion] = useState("");
  const [voucher, setVoucher] = useState<File | null>(null);
  const vistaVoucher = useMemo(
    () => (voucher?.type.startsWith("image/") ? URL.createObjectURL(voucher) : null),
    [voucher],
  );
  useEffect(() => () => {
    if (vistaVoucher) URL.revokeObjectURL(vistaVoucher);
  }, [vistaVoucher]);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rechazar, setRechazar] = useState(false);
  const [historial, setHistorial] = useState<number | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  // Si la orden ya tiene factura, por defecto el proveedor emite nota de crédito y factura nueva.
  // Lo que hay que corregir define hasta dónde vuelve la orden (lo mínimo: datos o documentos). La factura o los
  // precios anulan la factura: sin poder anularla, solo datos.
  const puedeAnular = destino.ordenPagoId == null && comprobantes.length > 0 && !sinAnular;
  const [correccion, setCorreccion] = useState<Correccion>("DATOS");
  // Volvió corregida de un rechazo: Tesorería ve qué se corrigió.
  const reenviada = rechazos[0]?.reenviado ? rechazos[0] : null;

  const confirmarRechazo = () =>
    startTransition(async () => {
      setError(null);
      const r = await rechazarDocumento({
        ...destino,
        motivo: motivoRechazo,
        ...(destino.ordenPagoId == null ? { correccion: puedeAnular ? correccion : "DATOS" } : {}),
      });
      if (!r.ok) return setError(r.error);
      setRechazar(false);
      router.push("/tesoreria");
    });

  const listo = Number(monto) > 0 && Number(monto) <= saldo + 0.005 && !!banco && operacion.trim() !== "" && voucher != null;

  const abrirPdf = () =>
    startTransition(async () => {
      if (!pdfOrden) return;
      const { ordenPdfBlob } = await import("@/lib/pdf/orden-pdf");
      abrirBlob(await ordenPdfBlob(pdfOrden.orden, pdfOrden.items), `${pdfOrden.orden.tipo}-${pdfOrden.orden.numero}.pdf`, pwa);
    });

  const aprobar = () =>
    startTransition(async () => {
      setError(null);
      let path: string | null = null;
      try {
        const [subido] = await subirArchivos(carpetaVoucher, [voucher!]);
        path = subido.path;
        const res = await pagarDocumento({
          ...destino,
          fecha: fechaPago,
          banco: banco ?? "",
          numeroOperacion: operacion,
          monto: Number(monto),
          voucherPath: subido.path,
          voucherNombre: subido.nombre,
        });
        if (!res.ok) throw new Error(res.error);
        setConfirmar(false);
        setVoucher(null);
        setOperacion("");
        router.refresh();
      } catch (e) {
        setConfirmar(false);
        setError(e instanceof Error ? e.message : "No se pudo registrar el pago");
        // El voucher subido queda huérfano si el pago falla: se elimina.
        if (path) await createClient().storage.from("documentos").remove([path]);
      }
    });

  return (
    <>
      <TopBar title={titulo} back={volverA} right={<SelectorDiseno pantalla={pantallaDiseno} tipo="items" actual={diseno} />} />
      <main className={cn("mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3", pendiente ? "pb-28" : "pb-10")}>
        <section className="rounded-panel bg-surface px-4 py-1">
          {datos.map(([k, v, copiable]) =>
            copiable ? (
              <Dato key={k} label={k} valor={v || "—"} />
            ) : (
              <div key={k} className="border-b border-line py-2 last:border-0">
                <div className="text-sm text-ink-3">{k}</div>
                <div className="break-words">{v || "—"}</div>
              </div>
            ),
          )}
        </section>

        {reenviada && pendiente && (
          <section aria-label="Reenviada" className="rounded-panel bg-ok-bg p-4">
            <p className="font-semibold text-ok">
              Reenviada por Logística el {fecha(reenviada.reenviado!.fecha)}
              {reenviada.reenviado!.por && ` (${reenviada.reenviado!.por})`}
            </p>
            {reenviada.reenviado!.nota && <p className="mt-1">{reenviada.reenviado!.nota}</p>}
            <p className="mt-1 text-[14px] text-ink-2">
              Rechazo{reenviada.correccion ? ` (${CORRECCION_LABEL[reenviada.correccion].toLowerCase()})` : ""}: {reenviada.motivo ?? "sin motivo"}
            </p>
          </section>
        )}
        {lineas.length > 0 && diseno !== "lista" && (
          <ItemsOrden
            diseno={diseno}
            items={lineas.map((l) => ({ ...l, etapa: l.etapa ?? null, parcial: Number(l.parcial ?? 0) }))}
          />
        )}
        {lineas.length > 0 && diseno === "lista" && (
          <Lista encabezado={[<Pila key="i">{["Descripción", "Cantidad y P.U.", "P.U. de otras órdenes"]}</Pila>, "Parcial"]}>
            {lineas.map((l) => (
              <li key={l.id} className="border-b border-line px-4 py-3 last:border-0">
                <div className="leading-snug">
                  {l.descripcion} <MarcaAdicional requerimiento={l.requerimiento} />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-3">
                  <span className="num text-sm">
                    {qty(l.cantidad)} <span className="text-ink-3">{l.unidad}</span>
                    <span className="ml-3 text-ink-2">P.U. {solesPu(l.pu)}</span>
                    {l.puPresupuesto != null && l.pu != null && (
                      <span
                        className={cn(
                          "ml-2 rounded-[5px] px-1 text-[13px]",
                          CLASE_TONO[tonoPrecio(Number(l.pu), Number(l.puPresupuesto), l.puPresupuesto)],
                        )}
                        title="Diferencia contra el presupuesto"
                      >
                        {textoDiferencia(Number(l.pu), Number(l.puPresupuesto))}
                      </span>
                    )}
                    {l.puPresupuesto == null && l.pu != null && l.puUltimo != null && (
                      <span
                        className={cn(
                          "ml-2 rounded-[5px] px-1 text-[13px]",
                          CLASE_TONO[tonoPrecio(Number(l.pu), Number(l.puUltimo), l.puMax)],
                        )}
                        title="Diferencia contra el último precio pagado"
                      >
                        {textoDiferencia(Number(l.pu), Number(l.puUltimo))}
                      </span>
                    )}
                  </span>
                  <span className="num font-medium">S/ {money(l.parcial)}</span>
                </div>
                {(l.puMin != null || l.puUltimo != null) && (
                  <div className="num mt-1 flex gap-4 text-[13px] text-ink-3">
                    <span>Mín {soles(l.puMin)}</span>
                    <span>Máx {soles(l.puMax)}</span>
                    <span>Últ {soles(l.puUltimo)}</span>
                  </div>
                )}
                {l.partidaId != null && (
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="num flex flex-col text-[14px] leading-snug text-ink-2">
                      <span>
                        Ejecutado {qty(l.ejecutado ?? 0)} / {qty(l.presupuestado ?? 0)} {l.unidad}
                      </span>
                      <span>
                        S/ {money(l.montoEjecutado ?? 0)} / {money(l.montoPresupuestado ?? 0)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setHistorial(historial === l.id ? null : l.id)}
                      aria-expanded={historial === l.id}
                      className="flex h-11 items-center gap-1 text-[14px] font-semibold text-primary"
                    >
                      Historial <ChevronDown size={16} className={cn("transition-transform", historial === l.id && "rotate-180")} />
                    </button>
                  </div>
                )}
                {historial === l.id && l.partidaId != null && (
                  <div className="-mx-4 mt-1">
                    <OrdenesPartida
                      partidaId={l.partidaId}
                      unidad={l.unidad}
                      antesDe={destino.numero ? { numero: destino.numero, fecha: pdfOrden?.orden.fecha ?? null } : undefined}
                    />
                  </div>
                )}
              </li>
            ))}
          </Lista>
        )}

        <section className="num flex flex-col gap-1 rounded-panel bg-surface p-4">
          {garantia > 0.005 && (
            <>
              <div className="flex justify-between text-ink-2">
                <span>Subtotal</span>
                <span>{soles(total + descuentos + garantia)}</span>
              </div>
              <div className="flex justify-between text-ink-2">
                <span>Retención por garantía</span>
                <span>− {soles(garantia)}</span>
              </div>
            </>
          )}
          {descuentos > 0.005 && (
            <>
              <div className="flex justify-between text-ink-2">
                <span>Total de la orden</span>
                <span>{soles(total + descuentos)}</span>
              </div>
              {detraccion > 0.005 && (
                <div className="flex justify-between text-ink-2">
                  <span>Detracción</span>
                  <span>− {soles(detraccion)}</span>
                </div>
              )}
              {retencion > 0.005 && (
                <div className="flex justify-between text-ink-2">
                  <span>Retención 4ta</span>
                  <span>− {soles(retencion)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1 font-semibold">{descuentos > 0.005 ? "A pagar" : "Total"}</span>
            <span className="rotulo text-[26px] font-semibold leading-none">{soles(total)}</span>
            {pendiente && pagado === 0 && <BotonCopiar valor={saldo.toFixed(2)} label="monto a pagar" className="-mr-2" />}
          </div>
          {pagado > 0 && (
            <div className="flex justify-between text-ink-2">
              <span>Pagado</span>
              <span>{soles(pagado)}</span>
            </div>
          )}
          {pendiente && pagado > 0 && (
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span className="flex-1">Saldo</span>
              <span>{soles(saldo)}</span>
              <BotonCopiar valor={saldo.toFixed(2)} label="saldo a pagar" className="-mr-2" />
            </div>
          )}
        </section>

        {contexto}

        {comprobantes.map((c) => (
          <section key={c.id} className="flex flex-col gap-2 rounded-panel bg-surface p-3">
            <div className="flex items-center gap-2 pl-1">
              <div className="min-w-0 flex-1">
                <h2 className="rotulo text-[19px] font-semibold leading-tight">{c.etiqueta}</h2>
                <span className="num flex gap-3 text-[15px] text-ink-2">
                  <span>{fecha(c.fechaEmision)}</span>
                  <span>{soles(c.total)}</span>
                </span>
              </div>
              <BotonCopiar valor={c.etiqueta.split(" ").pop() ?? c.etiqueta} label={`número de ${c.etiqueta}`} />
            </div>
            {((c.retencion ?? 0) > 0 || (c.detraccion ?? 0) > 0) && (
              <dl className="num grid grid-cols-[1fr_auto] gap-x-3 px-1 text-[15px]">
                {(c.retencion ?? 0) > 0 && (
                  <>
                    <dt className="text-ink-2">Retención</dt>
                    <dd className="text-right">− {soles(c.retencion)}</dd>
                  </>
                )}
                {(c.detraccion ?? 0) > 0 && (
                  <>
                    <dt className="text-ink-2">Detracción</dt>
                    <dd className="text-right">− {soles(c.detraccion)}</dd>
                  </>
                )}
              </dl>
            )}
            <ComprobanteArchivo comprobanteId={c.id} archivo={c.archivo} etiqueta={c.etiqueta} historico={c.historico} />
          </section>
        ))}

        {(enlaces.length > 0 || pdfOrden) && (
          <section className="overflow-hidden rounded-panel bg-surface">
            {enlaces.map((e) => (
              <EnlaceArchivo
                key={e.url}
                href={e.url}
                nombre={e.label}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 last:border-0 active:bg-ink/8"
              >
                <FileText size={18} className="shrink-0 text-ink-3" />
                <span className="flex-1 truncate">{e.label}</span>
                <ExternalLink size={16} className="shrink-0 text-ink-3" />
              </EnlaceArchivo>
            ))}
            {pdfOrden && (
              <button
                type="button"
                onClick={abrirPdf}
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-ink/8"
              >
                <FileText size={18} className="shrink-0 text-ink-3" />
                <span className="flex-1">{titulo}</span>
                <ExternalLink size={16} className="shrink-0 text-ink-3" />
              </button>
            )}
          </section>
        )}

        {pagos.length > 0 && (
          <Lista encabezado={[<Pila key="i">{["Pago", "Banco y fecha", "Voucher"]}</Pila>, "Monto"]}>
            {pagos.map((p) => (
              <li key={p.id} className="border-b border-line px-4 py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num font-medium">Op. {p.numero_operacion ?? "—"}</span>
                  <span className="rotulo text-[19px] font-medium">{soles(p.monto)}</span>
                </div>
                <div className="num flex gap-3 text-sm text-ink-3">
                  <span>{p.banco ?? "—"}</span>
                  <span>{fecha(p.fecha)}</span>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {p.vouchers.length === 0 ? (
                    <Voucher pagoId={p.id} historico={p.historico} />
                  ) : (
                    p.vouchers.map((v) => <Voucher key={v.url} pagoId={p.id} archivo={v} />)
                  )}
                </div>
              </li>
            ))}
          </Lista>
        )}

        {bloqueo && pendiente && (
          <p role="alert" className="rounded-panel bg-warn-bg px-4 py-3 font-semibold text-warn">
            {bloqueo}
          </p>
        )}
        {pendiente && (
          // Con un bloqueo (p. ej. falta la guía) no se puede llenar el pago.
          <fieldset disabled={!!bloqueo} className="m-0 flex min-w-0 flex-col gap-4 rounded-panel border-0 bg-surface p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Monto">
                <Input value={soles(saldo)} readOnly aria-readonly className="num text-right" />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
              </Field>
            </div>
            <Field label="Banco">
              <SearchSelect
                label="Banco"
                value={banco}
                onChange={setBanco}
                options={[...new Set([...(banco ? [banco] : []), ...BANCOS])].map((b) => ({ value: b, label: b }))}
              />
            </Field>
            <Field label="N° de operación">
              <Input
                value={operacion}
                onChange={(e) => setOperacion(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                className="num"
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] font-medium text-ink-2">Voucher</span>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="image/*,application/pdf"
                onChange={(e) => setVoucher(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(inputClass, "flex items-center gap-2 text-left", voucher ? "text-ink" : "text-ink-3")}
              >
                {voucher ? <Check size={18} className="shrink-0 text-ok" /> : <Camera size={18} className="shrink-0" />}
                <span className="truncate">{voucher ? voucher.name : "Subir voucher"}</span>
              </button>
              {vistaVoucher && (
                // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob)
                <img src={vistaVoucher} alt="Voucher elegido" className="max-h-72 w-full rounded-field border border-line object-contain" />
              )}
            </div>
            {error && <p role="alert" className="text-danger">{error}</p>}
          </fieldset>
        )}
        {entregas}
        {rechazos.length > 0 && (
          <Plegable titulo={`Rechazos (${rechazos.length})`}>
            <HistorialRechazos rechazos={rechazos} />
          </Plegable>
        )}
      </main>

      {pendiente && (
        <ActionBar>
          <Button variant="secondary" disabled={pending} onClick={() => setRechazar(true)}>
            Rechazar
          </Button>
          <Button className="flex-1" disabled={!listo || pending || !!bloqueo} onClick={() => setConfirmar(true)}>
            Aprobar pago
          </Button>
        </ActionBar>
      )}
      {rechazar && (
        <Sheet
          open
          onClose={() => setRechazar(false)}
          title={`Rechazar ${titulo}`}
          footer={
            <Button
              variant="danger"
              size="lg"
              disabled={pending || (destino.ordenPagoId == null && motivoRechazo.trim().length < 5)}
              onClick={confirmarRechazo}
            >
              Rechazar
            </Button>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            {destino.ordenPagoId == null && (
              <section aria-label="Qué hay que corregir" className="flex flex-col gap-2">
                <h3 className="text-[15px] font-medium text-ink-2">Qué hay que corregir</h3>
                {(
                  [
                    ["DATOS", "Vuelve a Logística con su factura"],
                    ["FACTURA", "El proveedor emite factura nueva"],
                    ["PRECIOS", "Vuelve a cotización y factura nueva"],
                  ] as [Correccion, string][]
                ).map(([c, detalle]) => {
                  const deshabilitada = c !== "DATOS" && !puedeAnular;
                  return (
                    <label
                      key={c}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-field border px-3 py-2",
                        correccion === c ? "border-primary bg-primary/10" : "border-line",
                        deshabilitada && "opacity-50",
                      )}
                    >
                      <input
                        type="radio"
                        name="correccion"
                        checked={correccion === c}
                        disabled={deshabilitada}
                        onChange={() => setCorreccion(c)}
                        className="h-5 w-5 shrink-0 accent-primary"
                      />
                      <span className="flex flex-col">
                        <span className="font-semibold">{CORRECCION_LABEL[c]}</span>
                        <span className="text-[14px] text-ink-2">{detalle}</span>
                      </span>
                    </label>
                  );
                })}
              </section>
            )}
            <Field label={destino.ordenPagoId == null ? "Motivo" : "Motivo (opcional)"}>
              <textarea
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                rows={3}
                className={cn(inputClass, "h-auto py-3")}
              />
            </Field>
            {sinAnular && destino.ordenPagoId == null && (
              <p className="text-ink-2">{sinAnular}: solo se puede pedir corregir datos o documentos.</p>
            )}
          </div>
        </Sheet>
      )}
      <Confirm open={confirmar} title="¿Aprobar pago?" onYes={aprobar} onNo={() => setConfirmar(false)} pending={pending}>
        <p className="rotulo text-[34px] font-semibold leading-none">S/ {money(Number(monto))}</p>
        <p className="num flex gap-3 text-ink-2">
          <span>Op. {operacion}</span>
          <span>{banco}</span>
        </p>
      </Confirm>
    </>
  );
}
