"use client";

import { Check, ChevronRight, FileText, FolderDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AsientoView } from "@/components/asiento-view";
import { Voucher } from "@/components/voucher";
import { Lista, Pila } from "@/components/lista";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, soles, solesPu, qty } from "@/lib/format";
import { periodoLabel } from "@/lib/periodos";
import { TIPO_COMPROBANTE_LABEL, type VRegistroCompra } from "@/lib/types";
import { actualizarPeriodo, cambiarDestinoIgv, contabilizarComprobante, expedienteComprobante, type ExpedienteDetalle } from "../actions";
import { EnlaceArchivo } from "@/components/visor";

/** `guia` / `contrato`: null si no le toca; si no, si ya está. */
type Expediente = Record<number, { ok: number; req: number; guia: boolean | null; contrato: boolean | null }>;

const TIPO_CORTO: Record<string, string> = { FACTURA: "Factura", RXH: "RH", BOLETA: "Boleta", RECIBO_SIMPLE: "Recibo", OTRO: "Otro" };

const DESTINOS = [
  { value: "DGNG", label: "Operaciones gravadas y no gravadas", hint: "DGNG" },
  { value: "DNG", label: "Operaciones no gravadas", hint: "DNG" },
];

/** Periodos posibles de anotación: el de emisión y los 11 siguientes. */
function periodosDesde(emision: string) {
  let y = Number(emision.slice(0, 4));
  let m = Number(emision.slice(4, 6));
  return Array.from({ length: 12 }, () => {
    const p = `${y}${String(m).padStart(2, "0")}`;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return p;
  });
}

export function ComprasList({ filas, expediente }: { filas: VRegistroCompra[]; expediente: Expediente }) {
  const [activa, setActiva] = useState<VRegistroCompra | null>(null);
  return (
    <>
      <Lista
        encabezado={[
          <Pila key="i">{["Proveedor", "Comprobante, emisión y expediente"]}</Pila>,
          <Pila key="d">{["Total", "Estado"]}</Pila>,
        ]}
      >
        {filas.map((f) => {
          const exp = expediente[f.comprobante_id];
          const completo = exp && exp.ok >= exp.req;
          return (
            <li key={f.comprobante_id} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => setActiva(f)}
                className="grid w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left active:bg-ink/8"
              >
                <span className="truncate">{f.proveedor}</span>
                <span className="rotulo text-right text-[19px] font-medium">{soles(f.total)}</span>
                <span className="num flex gap-3 text-sm text-ink-3">
                  <span>{TIPO_CORTO[f.tipo] ?? f.tipo}</span>
                  <span>
                    {f.serie}-{f.numero}
                  </span>
                  <span>{fecha(f.fecha_emision)}</span>
                  {exp && (
                    <span className={completo ? "text-ok" : "font-semibold text-warn"}>
                      {exp.ok}/{exp.req}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "text-right text-sm",
                    f.asiento_id ? "text-ink-3" : (f.items_sin_cuenta ?? 0) > 0 ? "font-semibold text-warn" : "text-ink-2",
                  )}
                >
                  {f.asiento_id
                    ? "Contabilizado"
                    : (f.items_sin_cuenta ?? 0) > 0
                      ? `${f.items_sin_cuenta} sin cuenta`
                      : "Por contabilizar"}
                </span>
              </button>
            </li>
          );
        })}
        {filas.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin comprobantes</li>}
      </Lista>
      {activa && <CompraSheet fila={activa} exp={expediente[activa.comprobante_id]} onClose={() => setActiva(null)} />}
    </>
  );
}

function CompraSheet({ fila, exp: marcas, onClose }: { fila: VRegistroCompra; exp?: Expediente[number]; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [exp, setExp] = useState<ExpedienteDetalle | null>(null);
  // Al contabilizar la hoja sigue abierta y muestra el asiento generado.
  const [asientoId, setAsientoId] = useState(fila.asiento_id);
  const contabilizado = asientoId != null;
  const asientoRef = useRef<HTMLDivElement>(null);
  const recien = asientoId != null && fila.asiento_id == null;
  const alAsiento = useCallback(() => asientoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), []);
  const [destino, setDestino] = useState(fila.destino_igv);
  const sinCuenta = fila.items_sin_cuenta ?? 0;

  const cargar = useCallback(() => {
    expedienteComprobante(fila.comprobante_id).then((r) => (r.ok ? setExp(r.data) : setError(r.error)));
  }, [fila.comprobante_id]);
  useEffect(cargar, [cargar]);

  const contabilizar = () =>
    startTransition(async () => {
      setError(null);
      const res = await contabilizarComprobante(fila.comprobante_id);
      if (!res.ok) return setError(res.error);
      setAsientoId(res.data);
      router.refresh();
    });

  const cambiarPeriodo = (p: string) =>
    startTransition(async () => {
      const res = await actualizarPeriodo(fila.comprobante_id, p);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });

  const cambiarDestino = (d: string) =>
    startTransition(async () => {
      const res = await cambiarDestinoIgv(fila.comprobante_id, d as "DGNG" | "DNG");
      if (!res.ok) return setError(res.error);
      setDestino(d);
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${TIPO_COMPROBANTE_LABEL[fila.tipo]} ${fila.serie}-${fila.numero}`}
      full
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
          <ButtonLink
            href={`/contabilidad/expediente?comprobante=${fila.comprobante_id}`}
            prefetch={false}
            variant="secondary"
            aria-label="Descargar expediente"
          >
            <FolderDown size={18} /> ZIP
          </ButtonLink>
          {!contabilizado &&
            (sinCuenta > 0 ? (
              <ButtonLink href={`/contabilidad?comprobante=${fila.comprobante_id}`} variant="secondary" className="flex-1">
                Asignar cuentas ({sinCuenta})
              </ButtonLink>
            ) : (
              <Button className="flex-1" onClick={contabilizar} disabled={pending}>
                Contabilizar
              </Button>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">Proveedor</dt>
          <dd>{fila.proveedor}</dd>
          <dt className="text-ink-3">RUC</dt>
          <dd>{fila.proveedor_ruc}</dd>
          <dt className="text-ink-3">Emisión</dt>
          <dd>{fecha(fila.fecha_emision)}</dd>
          <dt className="text-ink-3">Base</dt>
          <dd>{soles(fila.base)}</dd>
          <dt className="text-ink-3">IGV</dt>
          <dd>{soles(fila.igv)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{soles(fila.total)}</dd>
          {fila.retencion > 0 && (
            <>
              <dt className="text-ink-3">Retención de 4ta</dt>
              <dd>{soles(fila.retencion)}</dd>
            </>
          )}
          {(exp?.detraccion ?? 0) > 0 && (
            <>
              <dt className="text-ink-3">Detracción</dt>
              <dd>{soles(exp!.detraccion)}</dd>
            </>
          )}
        </dl>

        <Field label="Periodo de anotación">
          <SearchSelect
            label="Periodo de anotación"
            value={fila.periodo}
            onChange={cambiarPeriodo}
            disabled={contabilizado || pending}
            options={periodosDesde(fila.periodo_emision ?? fila.periodo ?? "").map((p) => ({ value: p, label: periodoLabel(p) }))}
          />
        </Field>
        {fila.tipo === "FACTURA" && fila.igv > 0 && (
          <Field label="IGV destinado a">
            <SearchSelect
              label="IGV destinado a"
              value={destino}
              onChange={cambiarDestino}
              disabled={contabilizado || pending}
              options={DESTINOS}
            />
          </Field>
        )}

        {!exp && !error && <p className="text-ink-3">Cargando…</p>}
        {exp && (
          <>
            <ul aria-label="Artículos" className="overflow-hidden rounded-panel border border-line">
              <li className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2 text-[13px] font-medium leading-tight text-ink-2">
                <span className="flex flex-col">
                  <span>Descripción</span>
                  <span>Cuenta</span>
                </span>
                <span className="flex flex-col text-right">
                  <span>P.U.</span>
                  <span>Cantidad</span>
                </span>
              </li>
              {exp.lineas.map((l) => (
                <li key={l.id} className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="leading-snug">{l.descripcion}</span>
                  <span className="num text-right">{solesPu(l.pu)}</span>
                  <span className={cn("num text-sm", l.cuenta ? "text-ink-2" : "font-semibold text-warn")}>{l.cuenta ?? "Sin cuenta"}</span>
                  <span className="num whitespace-nowrap text-right text-sm text-ink-2">
                    {qty(l.cantidad)} {l.unidad}
                  </span>
                </li>
              ))}
            </ul>
            <section className="overflow-hidden rounded-panel border border-line">
              <FilaDoc label="Comprobante" url={exp.archivoUrl} historico={exp.historico} />
              {/* La orden completa (PDF, contrato, guía, pagos, entregas), en su consulta. */}
              {exp.ordenes.map((o) => (
                <Link
                  key={`${o.obra_id}-${o.numero}`}
                  href={`/consulta/orden/${o.obra_id}/${encodeURIComponent(o.numero)}`}
                  prefetch={false}
                  className="flex min-h-12 items-center gap-3 border-b border-line px-4 text-primary last:border-0 active:bg-ink/8"
                >
                  <span className="flex-1 font-medium">
                    {o.tipo} {o.numero}
                  </span>
                  <ChevronRight size={18} className="shrink-0" />
                </Link>
              ))}
              {marcas?.guia != null && <FilaMarca label="Guía de remisión" ok={marcas.guia} historico={exp.historico} />}
              {marcas?.contrato != null && <FilaMarca label="Contrato firmado" ok={marcas.contrato} historico={exp.historico} />}
              {exp.vouchers.length === 0 && <FilaDoc label="Voucher" url={null} historico={exp.historico} />}
            </section>
            {exp.vouchers.map((v) => (
              <Voucher key={v.id} pagoId={v.pago_id ?? 0} archivo={v} />
            ))}
          </>
        )}
        {asientoId != null && (
          <div ref={asientoRef} className="scroll-mt-2">
            <AsientoView id={asientoId} onListo={recien ? alAsiento : undefined} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Un documento que está en la orden (se ve en su consulta y va en el ZIP): si está o si falta. */
function FilaMarca({ label, ok, historico }: { label: string; ok: boolean; historico: boolean }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-4 last:border-0">
      <span className="flex-1 font-medium text-ink-2">{label}</span>
      {ok ? (
        <Check size={18} className="text-ok" aria-label="Está" />
      ) : historico ? (
        <span className="text-sm text-ink-3">Histórico · sin archivo</span>
      ) : (
        <span className="text-sm font-semibold text-warn">Falta</span>
      )}
    </div>
  );
}

function FilaDoc({ label, url, historico }: { label: string; url: string | null; historico: boolean }) {
  return url ? (
    <EnlaceArchivo
      href={url}
      nombre={label}
      className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 text-primary last:border-0 active:bg-ink/8"
    >
      <FileText size={18} className="shrink-0" />
      <span className="flex-1 truncate font-medium">{label}</span>
    </EnlaceArchivo>
  ) : (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-4 last:border-0">
      <span className="flex-1 font-medium text-ink-2">{label}</span>
      {historico ? <span className="text-sm text-ink-3">Histórico · sin archivo</span> : <span className="text-sm font-semibold text-warn">Falta</span>}
    </div>
  );
}
