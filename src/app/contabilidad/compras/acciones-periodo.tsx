"use client";

import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Sheet } from "@/components/ui/sheet";
import { hoyISO } from "@/lib/format";
import { periodoLabel } from "@/lib/periodos";
import { cerrarPeriodo, contabilizarComprobantes, type ResultadoLote } from "../actions";

/** Contabilizar todo lo del periodo que se pueda, y cerrar o reabrir el mes. */
export function AccionesPeriodo({
  empresaId,
  periodo,
  cerrado,
  porContabilizar,
}: {
  empresaId: number;
  periodo: string;
  cerrado: boolean;
  porContabilizar: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState<"lote" | "cerrar" | "reabrir" | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo se cierra un mes que ya terminó.
  const terminado = periodo < hoyISO().slice(0, 7).replace("-", "");

  const lote = () =>
    startTransition(async () => {
      setError(null);
      const r = await contabilizarComprobantes(porContabilizar);
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      setResultado(r.data);
      router.refresh();
    });
  const cierre = (cerrar: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await cerrarPeriodo(empresaId, periodo, cerrar);
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!cerrado && porContabilizar.length > 0 && (
          <Button className="flex-1" onClick={() => setConfirmar("lote")} disabled={pending}>
            Contabilizar {porContabilizar.length}
          </Button>
        )}
        {cerrado ? (
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmar("reabrir")} disabled={pending}>
            <Lock size={18} /> Cerrado · Reabrir
          </Button>
        ) : terminado ? (
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmar("cerrar")} disabled={pending}>
            <LockOpen size={18} /> Cerrar {periodoLabel(periodo)}
          </Button>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Confirm
        open={confirmar === "lote"}
        title={`¿Contabilizar ${porContabilizar.length} ${porContabilizar.length === 1 ? "comprobante" : "comprobantes"}?`}
        onYes={lote}
        onNo={() => setConfirmar(null)}
        pending={pending}
      />
      <Confirm
        open={confirmar === "cerrar"}
        title={`¿Cerrar ${periodoLabel(periodo)}?`}
        onYes={() => cierre(true)}
        onNo={() => setConfirmar(null)}
        pending={pending}
      >
        <p>Sus comprobantes y asientos ya no se podrán registrar, corregir ni anular hasta reabrirlo.</p>
      </Confirm>
      <Confirm
        open={confirmar === "reabrir"}
        title={`¿Reabrir ${periodoLabel(periodo)}?`}
        onYes={() => cierre(false)}
        onNo={() => setConfirmar(null)}
        pending={pending}
      />
      {resultado && (
        <Sheet open onClose={() => setResultado(null)} title={`${resultado.contabilizados} contabilizados`}>
          <div className="flex flex-col gap-3 p-4">
            {resultado.errores.length > 0 && (
              <section aria-label="No se contabilizaron">
                <h3 className="pb-1 font-semibold text-warn">No se contabilizaron {resultado.errores.length}</h3>
                <ul className="overflow-hidden rounded-panel border border-line">
                  {resultado.errores.map((e) => (
                    <li key={e.id} className="border-b border-line px-4 py-2.5 last:border-0">
                      <div className="num font-medium">{e.documento}</div>
                      <div className="text-sm text-ink-2">{e.error}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
