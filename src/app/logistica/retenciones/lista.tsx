"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { fecha, soles } from "@/lib/format";
import { crearOsRetenciones } from "../actions";

export type GrupoRetencion = {
  clave: string;
  obraId: number;
  obra: string;
  cerrada: boolean;
  proveedorId: number;
  proveedor: string;
  /** Retenido en OS ya pagadas: lo que entra en la OS de retenciones. */
  porDevolver: number;
  /** De OS aún sin pagar: todavía no se retuvo. */
  sinPagar: number;
  /** Ya va en una OS de retenciones aún sin pagar. */
  enDevolucion: number;
  /** Su OS de retenciones ya se pagó. */
  devuelto: number;
  ordenes: { numero: string; fecha: string | null; retenido: number; pagada: boolean; retenidaEn: string | null; devuelta: boolean }[];
};

export function ListaRetenciones({ grupos }: { grupos: GrupoRetencion[] }) {
  const router = useRouter();
  const [crear, setCrear] = useState<GrupoRetencion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmar = () =>
    startTransition(async () => {
      setError(null);
      const g = crear!;
      const r = await crearOsRetenciones(g.obraId, g.proveedorId);
      setCrear(null);
      if (!r.ok) return setError(r.error);
      router.push(`/logistica/ordenes/${g.obraId}/${encodeURIComponent(r.data)}?tipo=OS`);
    });

  return (
    <>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <ul aria-label="Retenciones por proveedor" className="overflow-hidden rounded-panel bg-surface">
        {grupos.map((g) => (
          <li key={g.clave} className="border-b border-line last:border-0">
            <details className="group">
              <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 active:bg-ink/8">
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{g.proveedor}</span>
                  <span className="block text-[14px] text-ink-3">{g.obra}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="num text-right">
                    <span className="block font-semibold">{soles(g.porDevolver + g.enDevolucion)}</span>
                    <span className="block text-[14px] text-ink-3">
                      {g.sinPagar > 0.005 ? `Sin pagar ${soles(g.sinPagar)}` : g.devuelto > 0.005 ? `Devuelto ${soles(g.devuelto)}` : `${g.ordenes.length} OS`}
                    </span>
                  </span>
                  <ChevronDown size={18} className="text-ink-3 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="flex flex-col gap-2 px-4 pb-3">
                <ul>
                  {g.ordenes.map((o) => (
                    <li key={o.numero}>
                      <Link
                        href={`/logistica/ordenes/${g.obraId}/${encodeURIComponent(o.numero)}?tipo=OS`}
                        prefetch={false}
                        className="num flex min-h-11 items-center justify-between gap-3 text-[15px] active:bg-ink/8"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">OS {o.numero}</span>
                          <span className="ml-2 text-ink-3">{fecha(o.fecha)}</span>
                          <span className="block text-[14px] text-ink-3">
                            {o.devuelta ? `Devuelta en OS ${o.retenidaEn}` : o.retenidaEn ? `Se devuelve en OS ${o.retenidaEn}` : o.pagada ? "Pagada" : "Sin pagar"}
                          </span>
                        </span>
                        <span className="shrink-0">{soles(o.retenido)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {g.porDevolver > 0.005 &&
                  (g.cerrada ? (
                    <Button variant="secondary" disabled={pending} onClick={() => setCrear(g)}>
                      Crear OS de retenciones
                    </Button>
                  ) : (
                    <p className="text-center text-[15px] font-medium text-ink-2">Obra sin cerrar</p>
                  ))}
              </div>
            </details>
          </li>
        ))}
        {grupos.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin retenciones</li>}
      </ul>
      <Confirm open={!!crear} title="¿Crear la OS de retenciones?" onYes={confirmar} onNo={() => setCrear(null)} pending={pending}>
        {crear && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-3">Obra</dt>
            <dd>{crear.obra}</dd>
            <dt className="text-ink-3">Proveedor</dt>
            <dd>{crear.proveedor}</dd>
            <dt className="text-ink-3">Monto</dt>
            <dd className="num">{soles(crear.porDevolver)}</dd>
          </dl>
        )}
      </Confirm>
    </>
  );
}
