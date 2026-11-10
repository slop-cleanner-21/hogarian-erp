"use client";

import { Check, Download, FileText, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { AsientoView } from "@/components/asiento-view";
import { subirArchivos } from "@/components/documentos";
import { Lista, Pila } from "@/components/lista";
import { Button, ButtonLink } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { CODIGOS_DETRACCION, codigoPorPorcentaje, quintoDiaHabil } from "@/lib/sunat";
import { Faltan } from "@/components/ui/faltan";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EnlaceArchivo } from "@/components/visor";
import { cn, fecha, hoyISO, soles } from "@/lib/format";
import { periodoLabel } from "@/lib/periodos";
import {
  anularPagoImpuesto,
  detallePagoImpuesto,
  guardarCuentaDetracciones,
  pagarDetracciones,
  pagarRetenciones,
  type DetallePagoImpuesto,
} from "../actions";

type Res = { ok: true; data?: unknown } | { ok: false; error: string };

// ------------------------------------------------------------------------------------------- formulario del pago
/** Fecha, N° y constancia de un pago; sube la constancia a la carpeta de la empresa y registra. */
function FormPago({
  empresaId,
  etiquetaNumero,
  monto,
  registrar,
  onListo,
}: {
  empresaId: number;
  etiquetaNumero: string;
  monto: number;
  registrar: (d: { fecha: string; numero: string; archivo: string }) => Promise<Res>;
  onListo: () => void;
}) {
  const [dia, setDia] = useState(hoyISO());
  const [numero, setNumero] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const falta = [!dia && "fecha", !numero.trim() && etiquetaNumero.toLowerCase(), !archivo && "constancia"];

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      try {
        const [subido] = await subirArchivos(`impuestos/${empresaId}`, [archivo!]);
        const r = await registrar({ fecha: dia, numero, archivo: subido.path });
        if (!r.ok) return setError(r.error);
        onListo();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir la constancia");
      }
    });

  return (
    <section aria-label="Pago" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha del pago">
          <Input type="date" value={dia} max={hoyISO()} onChange={(e) => setDia(e.target.value)} />
        </Field>
        <Field label={etiquetaNumero}>
          <Input value={numero} onChange={(e) => setNumero(e.target.value)} className="num" autoComplete="off" />
        </Field>
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept="application/pdf,image/*"
        aria-label="Constancia"
        onChange={(e) => {
          setArchivo(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn(inputClass, "flex items-center gap-2 text-left", archivo ? "text-ink" : "text-ink-3")}
      >
        {archivo ? <Check size={18} className="shrink-0 text-ok" /> : <Paperclip size={18} className="shrink-0" />}
        <span className="truncate">{archivo ? archivo.name : "Subir constancia"}</span>
      </button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Faltan items={falta} />
        <Button size="lg" onClick={guardar} disabled={pending || falta.some(Boolean)}>
          Registrar pago · {soles(monto)}
        </Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------- detracciones
export type FilaDetraccion = {
  comprobanteId: number;
  empresaId: number;
  empresa: string;
  proveedorId: number;
  proveedor: string;
  ruc: string;
  cuenta: string | null;
  documento: string;
  emision: string;
  total: number;
  detraccion: number;
  /** Cuándo Tesorería le pagó la factura al proveedor (si ya). */
  pagadoProveedor: string | null;
};

/** Detracciones por pagar: se eligen las de una empresa y se registra su pago (una constancia o un pago masivo). */
export function DetraccionesPorPagar({ filas }: { filas: FilaDetraccion[] }) {
  const router = useRouter();
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [pagar, setPagar] = useState(false);
  const [cuentaDe, setCuentaDe] = useState<FilaDetraccion | null>(null);
  const [txt, setTxt] = useState(false);
  // Solo cuenta lo elegido que sigue en la lista (si otro ya lo pagó, al recargar sale).
  const sel = filas.filter((f) => elegidas.has(f.comprobanteId));
  const empresaSel = sel[0]?.empresaId ?? null;
  const total = Math.round(sel.reduce((a, f) => a + f.detraccion, 0) * 100) / 100;

  // Un pago es de una empresa: elegir de otra empieza de nuevo con esa.
  const alternar = (f: FilaDetraccion) =>
    setElegidas((s) => {
      const n = new Set(empresaSel != null && empresaSel !== f.empresaId ? [] : s);
      if (n.has(f.comprobanteId)) n.delete(f.comprobanteId);
      else n.add(f.comprobanteId);
      return n;
    });

  return (
    <>
      <Lista encabezado={[<Pila key="i">{["Proveedor", "Comprobante y cuenta de detracciones"]}</Pila>, "Detracción"]}>
        {filas.map((f) => {
          const marcada = elegidas.has(f.comprobanteId);
          return (
            <li key={f.comprobanteId} className={cn("border-b border-line last:border-0", marcada && "bg-primary/8")}>
              <label className="flex cursor-pointer items-start gap-3 px-4 pb-1 pt-3">
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={() => alternar(f)}
                  aria-label={`Pagar la detracción de ${f.documento}`}
                  className="mt-0.5 h-6 w-6 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{f.proveedor}</span>
                  <span className="num flex flex-wrap gap-x-3 text-sm text-ink-3">
                    <span>{f.documento}</span>
                    <span>{fecha(f.emision)}</span>
                    <span>{f.empresa}</span>
                    {f.pagadoProveedor && <span>Factura pagada {fecha(f.pagadoProveedor)}</span>}
                    <Vence periodo={f.emision.slice(0, 7).replace("-", "")} />
                  </span>
                </span>
                <span className="rotulo shrink-0 whitespace-nowrap text-[19px] font-medium">{soles(f.detraccion)}</span>
              </label>
              <button
                type="button"
                onClick={() => setCuentaDe(f)}
                className={cn("num ml-9 flex min-h-11 items-center px-4 text-left text-sm", f.cuenta ? "text-primary" : "font-semibold text-warn")}
              >
                {f.cuenta ? `Cta. detracciones ${f.cuenta}` : "Sin cuenta de detracciones"}
              </button>
            </li>
          );
        })}
        {filas.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin detracciones por pagar</li>}
      </Lista>
      {sel.length > 0 && (
        <ActionBar sobreNav>
          <Button variant="secondary" onClick={() => setTxt(true)}>
            <Download size={18} /> TXT
          </Button>
          <Button className="flex-1" onClick={() => setPagar(true)}>
            Pagar {sel.length} · {soles(total)}
          </Button>
        </ActionBar>
      )}
      {pagar && sel.length > 0 && (
        <Sheet open onClose={() => setPagar(false)} title={sel.length === 1 ? `Detracción ${sel[0].documento}` : `${sel.length} detracciones`} full>
          <div className="flex flex-col gap-4 p-4">
            <ul aria-label="Detracciones" className="overflow-hidden rounded-panel border border-line">
              {sel.map((f) => (
                <li key={f.comprobanteId} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="truncate">{f.proveedor}</span>
                  <span className="num whitespace-nowrap text-right">{soles(f.detraccion)}</span>
                  <span className="num text-sm text-ink-3">{f.documento}</span>
                  <span className={cn("num text-right text-sm", f.cuenta ? "text-ink-3" : "font-semibold text-warn")}>
                    {f.cuenta ?? "Sin cuenta"}
                  </span>
                </li>
              ))}
            </ul>
            <FormPago
              empresaId={sel[0].empresaId}
              etiquetaNumero="N° de constancia"
              monto={total}
              registrar={(d) => pagarDetracciones({ ids: sel.map((f) => f.comprobanteId), ...d })}
              onListo={() => {
                setPagar(false);
                setElegidas(new Set());
                router.refresh();
              }}
            />
          </div>
        </Sheet>
      )}
      {cuentaDe && <CuentaDetraccionesSheet fila={cuentaDe} onClose={() => setCuentaDe(null)} />}
      {txt && sel.length > 0 && <TxtDetracciones filas={sel} onClose={() => setTxt(false)} />}
    </>
  );
}

function CuentaDetraccionesSheet({ fila, onClose }: { fila: FilaDetraccion; onClose: () => void }) {
  const router = useRouter();
  const [cuenta, setCuenta] = useState(fila.cuenta ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const guardar = () =>
    startTransition(async () => {
      const r = await guardarCuentaDetracciones(fila.proveedorId, cuenta);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={fila.proveedor}
      footer={
        <Button size="lg" onClick={guardar} disabled={pending || cuenta === (fila.cuenta ?? "")}>
          Guardar
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="num text-ink-3">{fila.ruc}</p>
        <Field label="Cuenta de detracciones (Banco de la Nación)">
          <Input value={cuenta} onChange={(e) => setCuenta(e.target.value)} inputMode="numeric" className="num" autoComplete="off" />
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

// ------------------------------------------------------------------------------------------- retenciones de 4ta
export type GrupoRetencion = {
  empresaId: number;
  empresa: string;
  /** AAAAMM: el mes en que se pagaron los recibos (cuando se retuvo). */
  periodo: string;
  total: number;
  recibos: { id: number; proveedor: string; ruc: string; documento: string; pagado: string; total: number; retencion: number }[];
};

/** Retenciones de 4ta por pagar, por empresa y mes: se paga todo lo retenido de ese mes. */
export function RetencionesPorPagar({ grupos }: { grupos: GrupoRetencion[] }) {
  const router = useRouter();
  const [activo, setActivo] = useState<GrupoRetencion | null>(null);
  return (
    <>
      <Lista encabezado={[<Pila key="i">{["Mes del pago de los recibos", "Empresa"]}</Pila>, "Retenido"]}>
        {grupos.map((g) => (
          <li key={`${g.empresaId}-${g.periodo}`} className="border-b border-line last:border-0">
            <button type="button" onClick={() => setActivo(g)} className="grid w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left active:bg-ink/8">
              <span className="rotulo text-[19px] font-semibold">{periodoLabel(g.periodo)}</span>
              <span className="rotulo whitespace-nowrap text-right text-[19px] font-medium">{soles(g.total)}</span>
              <span className="truncate text-sm text-ink-3">{g.empresa}</span>
              <span className="text-right text-sm text-ink-3">
                {g.recibos.length} {g.recibos.length === 1 ? "recibo" : "recibos"}
              </span>
            </button>
          </li>
        ))}
        {grupos.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin retenciones por pagar</li>}
      </Lista>
      {activo && (
        <Sheet open onClose={() => setActivo(null)} title={`Retenciones ${periodoLabel(activo.periodo)} · ${activo.empresa}`} full>
          <div className="flex flex-col gap-4 p-4">
            <ul aria-label="Recibos" className="overflow-hidden rounded-panel border border-line">
              {activo.recibos.map((r) => (
                <li key={r.id} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="truncate">{r.proveedor}</span>
                  <span className="num whitespace-nowrap text-right">{soles(r.retencion)}</span>
                  <span className="num text-sm text-ink-3">
                    {r.documento} · pagado {fecha(r.pagado)}
                  </span>
                  <span className="num whitespace-nowrap text-right text-sm text-ink-3">de {soles(r.total)}</span>
                </li>
              ))}
            </ul>
            <ButtonLink
              href={`/contabilidad/impuestos/plame?empresa=${activo.empresaId}&periodo=${activo.periodo}`}
              prefetch={false}
              variant="secondary"
            >
              <Download size={18} /> Archivos para el PLAME
            </ButtonLink>
            <FormPago
              empresaId={activo.empresaId}
              etiquetaNumero="N° de orden u operación"
              monto={activo.total}
              registrar={(d) => pagarRetenciones({ empresaId: activo.empresaId, periodo: activo.periodo, monto: activo.total, ...d })}
              onListo={() => {
                setActivo(null);
                router.refresh();
              }}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------- pagados
export type PagoImpuesto = {
  id: number;
  empresa: string;
  tipo: "DETRACCION" | "RETENCION_4TA";
  periodo: string | null;
  fecha: string;
  numero: string;
  monto: number;
  comprobantes: number;
  anulado: boolean;
  motivo: string | null;
};

export function PagosImpuesto({ pagos }: { pagos: PagoImpuesto[] }) {
  const [activo, setActivo] = useState<PagoImpuesto | null>(null);
  return (
    <>
      <Lista encabezado={[<Pila key="i">{["N° y fecha", "Empresa"]}</Pila>, "Monto"]}>
        {pagos.map((p) => (
          <li key={p.id} className="border-b border-line last:border-0">
            <button type="button" onClick={() => setActivo(p)} className="grid w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left active:bg-ink/8">
              <span className="num truncate font-medium">{p.numero}</span>
              <span className={cn("rotulo whitespace-nowrap text-right text-[19px] font-medium", p.anulado && "text-ink-3 line-through")}>
                {soles(p.monto)}
              </span>
              <span className="num flex gap-3 text-sm text-ink-3">
                <span>{fecha(p.fecha)}</span>
                {p.periodo && <span>{periodoLabel(p.periodo)}</span>}
                <span className="truncate">{p.empresa}</span>
              </span>
              <span className={cn("text-right text-sm", p.anulado ? "font-semibold text-danger" : "text-ink-3")}>
                {p.anulado ? "Anulado" : `${p.comprobantes} ${p.comprobantes === 1 ? "comprobante" : "comprobantes"}`}
              </span>
            </button>
          </li>
        ))}
        {pagos.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin pagos</li>}
      </Lista>
      {activo && <PagoSheet pago={activo} onClose={() => setActivo(null)} />}
    </>
  );
}

function PagoSheet({ pago, onClose }: { pago: PagoImpuesto; onClose: () => void }) {
  const router = useRouter();
  const [det, setDet] = useState<DetallePagoImpuesto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    detallePagoImpuesto(pago.id).then((r) => (r.ok ? setDet(r.data) : setError(r.error)));
  }, [pago.id]);
  const titulo = useMemo(
    () => (pago.tipo === "DETRACCION" ? `Detracción ${pago.numero}` : `Retenciones ${pago.periodo ? periodoLabel(pago.periodo) : ""}`),
    [pago],
  );

  const confirmarAnular = () =>
    startTransition(async () => {
      const r = await anularPagoImpuesto(pago.id, motivo);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={titulo}
      full
      footer={
        !pago.anulado &&
        (anular ? (
          <div className="flex flex-col gap-2">
            <Faltan items={[!motivo.trim() && "motivo"]} />
            <Button variant="danger" size="lg" disabled={pending || !motivo.trim()} onClick={confirmarAnular}>
              Anular el pago
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="lg" onClick={() => setAnular(true)}>
            Anular
          </Button>
        ))
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">Empresa</dt>
          <dd>{pago.empresa}</dd>
          <dt className="text-ink-3">Fecha</dt>
          <dd>{fecha(pago.fecha)}</dd>
          <dt className="text-ink-3">{pago.tipo === "DETRACCION" ? "Constancia" : "Orden / operación"}</dt>
          <dd>{pago.numero}</dd>
          <dt className="font-semibold">Monto</dt>
          <dd className="font-semibold">{soles(pago.monto)}</dd>
          {pago.anulado && (
            <>
              <dt className="text-danger">Anulado</dt>
              <dd>{pago.motivo}</dd>
            </>
          )}
        </dl>
        {!det && !error && <p className="text-ink-3">Cargando…</p>}
        {det && (
          <>
            {det.archivoUrl && (
              <EnlaceArchivo
                href={det.archivoUrl}
                nombre="Constancia"
                className="flex min-h-12 items-center gap-3 rounded-panel border border-line px-4 text-primary active:bg-ink/8"
              >
                <FileText size={18} className="shrink-0" />
                <span className="flex-1 font-medium">Constancia</span>
              </EnlaceArchivo>
            )}
            <ul aria-label="Comprobantes" className="overflow-hidden rounded-panel border border-line">
              {det.comprobantes.map((c) => (
                <li key={c.id} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="truncate">{c.proveedor}</span>
                  <span className="num whitespace-nowrap text-right">{soles(c.monto)}</span>
                  <span className="num text-sm text-ink-3">{c.documento}</span>
                </li>
              ))}
            </ul>
            {det.asientoId != null && <AsientoView id={det.asientoId} />}
          </>
        )}
        {anular && (
          <Field label="Motivo de la anulación">
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={cn(inputClass, "h-auto py-3")} />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Plazo de la detracción: el 5.º día hábil del mes siguiente al de su comprobante (en rojo si ya pasó). */
function Vence({ periodo }: { periodo: string }) {
  const dia = quintoDiaHabil(periodo);
  const vencida = dia < hoyISO();
  return <span className={cn(vencida && "font-semibold text-danger")}>{vencida ? "Venció" : "Vence"} {fecha(dia)}</span>;
}

/** El TXT del pago masivo de SUNAT: lote y el código de bien o servicio de cada una (sale de su porcentaje). */
function TxtDetracciones({ filas, onClose }: { filas: FilaDetraccion[]; onClose: () => void }) {
  const [lote, setLote] = useState(`${hoyISO().slice(2, 4)}0001`);
  const [codigos, setCodigos] = useState<Record<number, string>>(() =>
    Object.fromEntries(filas.map((f) => [f.comprobanteId, codigoPorPorcentaje((f.detraccion / f.total) * 100)])),
  );
  const sinCuenta = filas.filter((f) => !f.cuenta || !/^\d{11}$/.test(f.cuenta));
  const falta = [!/^\d{6}$/.test(lote) && "lote de 6 dígitos", ...sinCuenta.map((f) => `cuenta de detracciones de ${f.proveedor}`)];
  const href = `/contabilidad/impuestos/detracciones?ids=${filas.map((f) => f.comprobanteId).join(",")}&lote=${lote}&codigos=${filas
    .map((f) => `${f.comprobanteId}:${codigos[f.comprobanteId]}`)
    .join(",")}`;
  const opciones = CODIGOS_DETRACCION.map((c) => ({ value: c.codigo, label: `${c.codigo} ${c.nombre}` }));
  const redondeado = filas.reduce((a, f) => a + Math.round(f.detraccion), 0);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Pago masivo de detracciones"
      full
      footer={
        <div className="flex flex-col gap-2">
          <Faltan items={falta} />
          {falta.some(Boolean) ? (
            <Button size="lg" disabled>
              Descargar TXT · {soles(redondeado)}
            </Button>
          ) : (
            <ButtonLink href={href} prefetch={false} size="lg">
              <Download size={18} /> Descargar TXT · {soles(redondeado)}
            </ButtonLink>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="N° de lote (año y correlativo)">
          <Input value={lote} onChange={(e) => setLote(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="num" />
        </Field>
        <ul aria-label="Depósitos" className="flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.comprobanteId} className="flex flex-col gap-2 rounded-panel border border-line p-3">
              <div className="grid grid-cols-[1fr_auto] gap-x-3">
                <span className="truncate">{f.proveedor}</span>
                <span className="num whitespace-nowrap text-right">{soles(Math.round(f.detraccion))}</span>
                <span className="num text-sm text-ink-3">{f.documento}</span>
                <span className={cn("num text-right text-sm", f.cuenta ? "text-ink-3" : "font-semibold text-warn")}>{f.cuenta ?? "Sin cuenta"}</span>
              </div>
              <SearchSelect
                label={`Bien o servicio de ${f.documento}`}
                value={codigos[f.comprobanteId]}
                onChange={(v) => setCodigos((c) => ({ ...c, [f.comprobanteId]: v }))}
                multilinea
                options={opciones}
              />
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
