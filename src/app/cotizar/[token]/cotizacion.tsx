"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { TemaProveedor } from "@/components/tema-proveedor";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/field";
import { fecha, qty, soles, solesPu } from "@/lib/format";
import { guardar, leer } from "@/lib/recordar";
import { enviarCotizacion } from "./actions";

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
      const err = await enviarCotizacion({
        token,
        precios: data.items.map((i) => ({ item_id: i.id, pu: Number(pu[i.id]) })),
      });
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
