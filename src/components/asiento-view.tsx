"use client";

import { useEffect, useState } from "react";
import { soles } from "@/lib/format";
import { verAsiento, type AsientoLinea } from "@/app/contabilidad/actions";

/** `onListo`: se llama una vez cargadas las líneas (p. ej. para desplazarse hasta el asiento). */
export function AsientoView({ id, onListo }: { id: number; onListo?: () => void }) {
  const [lineas, setLineas] = useState<AsientoLinea[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verAsiento(id).then((r) => (r.ok ? setLineas(r.data.lineas) : setError(r.error)));
  }, [id]);
  const cargado = lineas != null;
  useEffect(() => {
    if (cargado) onListo?.();
  }, [cargado, onListo]);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!lineas) return <p className="text-ink-3">Cargando…</p>;
  // Como el voucher de la empresa: las cuentas del comprobante y, aparte, sus amarres del plan.
  const grupos = [
    { titulo: "Cuentas de origen", lineas: lineas.filter((l) => !l.amarre) },
    { titulo: "Cuentas de amarre", lineas: lineas.filter((l) => l.amarre) },
  ].filter((g) => g.lineas.length > 0);
  const conTitulo = grupos.length > 1;

  return (
    <table className="num w-full text-sm">
      <thead>
        {/* Fija al desplazar: en asientos largos dice qué columna es Debe y cuál Haber. */}
        <tr className="text-left text-[13px] text-ink-3 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-surface [&>th]:shadow-[inset_0_-1px_0_var(--color-line)]">
          <th className="py-2 font-medium">Cuenta</th>
          <th className="py-2 pl-4 text-right font-medium">Debe</th>
          <th className="py-2 pl-4 text-right font-medium">Haber</th>
        </tr>
      </thead>
      {grupos.map((g) => (
        <tbody key={g.titulo}>
          {conTitulo && (
            <tr>
              <th colSpan={3} scope="colgroup" className="pb-1 pt-3 text-left text-[13px] font-semibold text-ink-2">
                {g.titulo}
              </th>
            </tr>
          )}
          {g.lineas.map((l, i) => (
            <tr key={i} className="border-b border-line align-top">
              <td className="py-2 pr-2">
                <div className="font-medium">{l.cuenta}</div>
                <div className="text-[13px] leading-snug text-ink-3">{l.denominacion}</div>
                {l.glosa && <div className="mt-1 border-l-2 border-line pl-2 text-[13px] leading-snug text-ink">{l.glosa}</div>}
              </td>
              <td className="whitespace-nowrap py-2 pl-4 text-right">{l.debe ? soles(l.debe) : ""}</td>
              <td className="whitespace-nowrap py-2 pl-4 text-right">{l.haber ? soles(l.haber) : ""}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2">{conTitulo ? "Subtotal" : "Total"}</td>
            <td className="whitespace-nowrap py-2 pl-4 text-right">{soles(g.lineas.reduce((a, l) => a + l.debe, 0))}</td>
            <td className="whitespace-nowrap py-2 pl-4 text-right">{soles(g.lineas.reduce((a, l) => a + l.haber, 0))}</td>
          </tr>
        </tbody>
      ))}
    </table>
  );
}
