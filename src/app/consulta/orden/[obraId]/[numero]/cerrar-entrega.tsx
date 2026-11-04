"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/format";
import { cerrarEntrega } from "@/app/consulta/actions";

/** Operaciones cierra la entrega cuando el proveedor ya no enviará el resto. */
export function CerrarEntrega({ obraId, numero }: { obraId: number; numero: string }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cerrar = () =>
    startTransition(async () => {
      setError(null);
      const r = await cerrarEntrega(obraId, numero, motivo);
      if (!r.ok) return setError(r.error);
      setAbierta(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="secondary" onClick={() => setAbierta(true)}>
        Cerrar entrega incompleta
      </Button>
      {abierta && (
        <Sheet
          open
          onClose={() => setAbierta(false)}
          title="Cerrar entrega incompleta"
          footer={
            <Button size="lg" variant="danger" onClick={cerrar} disabled={pending || !motivo.trim()}>
              Cerrar entrega
            </Button>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="text-ink-2">La orden queda recibida y lo que no llegó vuelve al saldo de la partida.</p>
            <Field label="Motivo">
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={cn(inputClass, "h-auto py-3")} />
            </Field>
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
