"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { guardarDetraccionMinimo } from "@/app/presupuesto/actions";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { money } from "@/lib/format";

/** Monto desde el que una factura lleva detracción (todas las obras). */
export function DetraccionMinimo({ monto }: { monto: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(String(monto));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarDetraccionMinimo(Number(valor));
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValor(String(monto));
          setAbierto(true);
        }}
        className="flex min-h-12 items-center gap-3 rounded-panel bg-surface px-4 text-left active:bg-sunken"
      >
        <span className="flex-1">Detracción desde</span>
        <span className="num font-semibold">S/ {money(monto)}</span>
        <Pencil size={18} aria-hidden className="text-ink-3" />
      </button>
      {abierto && (
        <Sheet
          open
          onClose={() => setAbierto(false)}
          title="Detracción desde"
          footer={
            <div className="flex flex-col gap-2">
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
              <Button size="lg" onClick={guardar} disabled={pending || valor === "" || Number(valor) < 0 || Number(valor) === monto}>
                Guardar
              </Button>
            </div>
          }
        >
          <div className="p-4">
            <Field label="Total de la factura mayor a (S/)">
              <NumberInput value={valor} onChange={(e) => setValor(e.target.value)} data-autofocus />
            </Field>
          </div>
        </Sheet>
      )}
    </>
  );
}
