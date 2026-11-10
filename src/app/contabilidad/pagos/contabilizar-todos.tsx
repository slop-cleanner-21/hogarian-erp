"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Sheet } from "@/components/ui/sheet";
import { contabilizarPagos, type ResultadoLote } from "../actions";

/** Contabiliza los pagos listados que se puedan; de los demás (p. ej. una OP sin cuenta), por qué no. */
export function ContabilizarTodos({ ids }: { ids: number[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!ids.length) return null;
  const correr = () =>
    startTransition(async () => {
      setError(null);
      const r = await contabilizarPagos(ids);
      setConfirmar(false);
      if (!r.ok) return setError(r.error);
      setResultado(r.data);
      router.refresh();
    });
  return (
    <>
      <Button onClick={() => setConfirmar(true)} disabled={pending}>
        Contabilizar {ids.length}
      </Button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Confirm
        open={confirmar}
        title={`¿Contabilizar ${ids.length} ${ids.length === 1 ? "pago" : "pagos"}?`}
        onYes={correr}
        onNo={() => setConfirmar(false)}
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
