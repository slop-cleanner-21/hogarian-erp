"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { TemaProveedor } from "@/components/tema-proveedor";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/field";
import { FileText, Receipt } from "lucide-react";
import { fecha, qty, soles, solesPu } from "@/lib/format";
import { guardar, leer } from "@/lib/recordar";

export type CotizacionData = {
  numero: string;
  tipo: "OC" | "OS";
  obra: string;
  empresa: string;
  proveedor: string;
  fecha: string;
  cotizacion_estado: "ENVIADA" | "RECIBIDA";
  /** «cotizar» mientras está cotizando; «orden» con los precios ya confirmados (la ve en el mismo link). */
  modo?: "cotizar" | "orden";
  estado?: "CONFIRMADA" | "EN_PAGO" | "PAGADA" | "ENVIADA" | null;
  /** Pagada: el link vale hasta esta fecha (15 días después del pago). */
  vence?: string | null;
  retencion?: number | null;
  detraccion?: number | null;
  pagos?: { id: number; fecha: string; monto: number; banco: string | null; operacion: string | null; vouchers: number[] }[] | null;
  /** OS: su contrato (el firmado, si Logística ya lo subió). */
  contrato?: { firmado: boolean } | null;
  items: { id: number; descripcion: string; unidad: string; cantidad: number; pu_cotizado: number | null }[];
};

type Precios = Record<number, string>;

// Lo que el proveedor ve de su orden en cada etapa.
const ESTADO_ORDEN: Record<NonNullable<CotizacionData["estado"]>, string> = {
  CONFIRMADA: "Confirmada",
  EN_PAGO: "En pago",
  PAGADA: "Pagada",
  ENVIADA: "Pagada · constancia enviada",
};

// Borrador del proveedor en su navegador: solo los precios de ESTA cotización (clave por token).
const claveBorrador = (token: string) => `cotizacion:${token}`;

const sinSuscripcion = () => () => {};

export function Cotizacion({ token, data }: { token: string; data: CotizacionData }) {
  // El borrador solo existe en el navegador: el formulario se monta de nuevo al hidratar para leerlo.
  const enCliente = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  return <Formulario key={enCliente ? "cliente" : "servidor"} token={token} data={data} conBorrador={enCliente} />;
}

function Formulario({ token, data, conBorrador }: { token: string; data: CotizacionData; conBorrador: boolean }) {
  const orden = data.modo === "orden";
  const [enviada, setEnviada] = useState(orden || data.cotizacion_estado === "RECIBIDA");
  const [pu, setPu] = useState<Precios>(() => {
    const base: Precios = Object.fromEntries(data.items.map((i) => [i.id, i.pu_cotizado == null ? "" : String(i.pu_cotizado)]));
    if (!conBorrador || orden || data.cotizacion_estado === "RECIBIDA") return base;
    return { ...base, ...(leer<Precios>(claveBorrador(token)) ?? {}) };
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = data.items.reduce((a, i) => a + (Number(pu[i.id]) || 0) * Number(i.cantidad), 0);
  const completa = data.items.every((i) => Number(pu[i.id]) > 0);

  const cambiar = (id: number, valor: string) =>
    setPu((p) => {
      const next = { ...p, [id]: valor };
      guardar(claveBorrador(token), next);
      return next;
    });

  const enviar = () =>
    startTransition(async () => {
      setError(null);
      const err = await fetch(`/cotizar/${token}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precios: data.items.map((i) => ({ item_id: i.id, pu: Number(pu[i.id]) })) }),
      })
        .then((r) => r.json() as Promise<{ error: string | null }>)
        .then((r) => r.error)
        .catch(() => "No se pudo enviar la cotización: revisa tu conexión");
      if (err) return setError(err);
      guardar(claveBorrador(token), null);
      setEnviada(true);
    });

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="rotulo text-[30px] font-semibold leading-none">
                {data.tipo} {data.numero}
              </h1>
              {orden && (
                <p className="mt-1 text-[15px] text-ink-2">
                  {data.tipo === "OS" ? "Orden de servicio" : "Orden de compra"}
                  {data.estado && <span className="ml-2 font-semibold text-ok">{ESTADO_ORDEN[data.estado]}</span>}
                </p>
              )}
            </div>
            <TemaProveedor />
          </div>
          <p className="mt-1.5 font-medium">{data.empresa}</p>
          <p className="flex gap-3 text-ink-2">
            <span>{data.obra}</span>
            <span className="num">{fecha(data.fecha)}</span>
          </p>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3">
        <div className="num grid grid-cols-[1fr_7rem_6rem] gap-2 px-4 text-sm font-medium text-ink-2">
          <span>CANT</span>
          <span className="text-right">P.U. (inc. IGV)</span>
          <span className="text-right">PARCIAL</span>
        </div>
        <ul className="overflow-hidden rounded-panel bg-surface">
          {data.items.map((i) => (
            <li key={i.id} className="border-b border-line px-4 py-3 last:border-0">
              <div className="leading-snug">{i.descripcion}</div>
              <div className="mt-2 grid grid-cols-[1fr_7rem_6rem] items-center gap-2">
                <span className="num text-sm">
                  {qty(i.cantidad)} <span className="text-ink-3">{i.unidad}</span>
                </span>
                {enviada ? (
                  <span className="num text-right">{pu[i.id] ? solesPu(Number(pu[i.id])) : "—"}</span>
                ) : (
                  <NumberInput
                    aria-label={`Precio unitario ${i.descripcion}`}
                    value={pu[i.id]}
                    onChange={(e) => cambiar(i.id, e.target.value)}
                    className="h-11"
                  />
                )}
                <span className="num text-right font-medium">
                  {pu[i.id] ? soles(Number(pu[i.id]) * Number(i.cantidad)) : "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between rounded-panel bg-surface p-4">
          <span className="font-semibold">Total</span>
          <span className="rotulo text-[28px] font-semibold">{soles(total)}</span>
        </div>
        {orden && <Orden token={token} data={data} />}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {enviada && !orden && <p role="status" className="font-medium text-ok">Cotización enviada</p>}
      </main>
      {!enviada && (
        <ActionBar>
          <Button size="lg" onClick={enviar} disabled={!completa || pending}>
            Enviar cotización
          </Button>
        </ActionBar>
      )}
    </>
  );
}

const ENLACE = "flex min-h-12 items-center gap-2 rounded-field px-1 font-semibold text-primary active:bg-ink/8";

/**
 * Lo que el proveedor ve de su orden ya confirmada: lo que se le descontó, sus pagos con el voucher y (OS) el
 * contrato. Solo para ver: nada se sube desde aquí.
 */
function Orden({ token, data }: { token: string; data: CotizacionData }) {
  const archivo = (q: string) => `/cotizar/${token}/archivo?${q}`;
  const pagos = data.pagos ?? [];
  return (
    <>
      {(Number(data.retencion) > 0 || Number(data.detraccion) > 0) && (
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-panel bg-surface p-4 text-[15px]">
          {Number(data.retencion) > 0 && (
            <>
              <dt className="text-ink-2">Retención 4ta</dt>
              <dd className="text-right">− {soles(Number(data.retencion))}</dd>
            </>
          )}
          {Number(data.detraccion) > 0 && (
            <>
              <dt className="text-ink-2">Detracción</dt>
              <dd className="text-right">− {soles(Number(data.detraccion))}</dd>
            </>
          )}
        </dl>
      )}
      {pagos.length > 0 && (
        <section aria-label="Pagos" className="rounded-panel bg-surface p-4">
          <h2 className="rotulo pb-1 text-[19px] font-semibold">Pagos</h2>
          <ul className="flex flex-col divide-y divide-line">
            {pagos.map((p) => (
              <li key={p.id} className="py-2">
                <div className="num flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-ink-2">
                    {fecha(p.fecha)}
                    {p.banco && ` · ${p.banco}`}
                    {p.operacion && ` · Op. ${p.operacion}`}
                  </span>
                  <span className="font-semibold">{soles(Number(p.monto))}</span>
                </div>
                {p.vouchers.map((v, i) => (
                  <a key={v} href={archivo(`tipo=voucher&id=${v}`)} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                    <Receipt size={19} /> Ver voucher{p.vouchers.length > 1 ? ` ${i + 1}` : ""}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.contrato && (
        <section aria-label="Contrato" className="rounded-panel bg-surface p-4">
          <a href={archivo("tipo=contrato")} target="_blank" rel="noopener noreferrer" className={ENLACE}>
            <FileText size={19} /> {data.contrato.firmado ? "Contrato firmado" : "Contrato para firmar"}
          </a>
        </section>
      )}
      {data.vence && <p className="num px-1 text-[14px] text-ink-3">Disponible hasta el {fecha(data.vence)}</p>}
    </>
  );
}
