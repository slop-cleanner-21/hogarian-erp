"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lista, Pila } from "@/components/lista";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { guardarTransportista } from "../actions";

export type Transportista = { id: number; ruc: string; razon_social: string; placa: string | null; licencia: string | null };
export const TRANSPORTISTA_VACIO: Transportista = { id: 0, ruc: "", razon_social: "", placa: null, licencia: null };

export function TransportistasList({ transportistas }: { transportistas: Transportista[] }) {
  const [editando, setEditando] = useState<Transportista | null>(null);
  return (
    <>
      <Lista encabezado={[<Pila key="i">{["Razón social", "RUC"]}</Pila>, <Pila key="p">{["Placa", "Licencia"]}</Pila>]}>
        {transportistas.map((t) => (
          <li key={t.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => setEditando(t)}
              className="grid w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left active:bg-ink/8"
            >
              <span className="truncate">{t.razon_social}</span>
              <span className="num text-right">{t.placa ?? "—"}</span>
              <span className="num text-sm text-ink-3">{t.ruc}</span>
              <span className="num text-right text-sm text-ink-3">{t.licencia ?? "—"}</span>
            </button>
          </li>
        ))}
        {transportistas.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin transportistas</li>}
      </Lista>
      <Button
        aria-label="Nuevo transportista"
        onClick={() => setEditando(TRANSPORTISTA_VACIO)}
        className="fixed bottom-20 right-4 z-30 h-14 w-14 rounded-full p-0 shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={24} />
      </Button>
      {editando && <FichaTransportista t={editando} onClose={() => setEditando(null)} />}
    </>
  );
}

/** Ficha del transportista; `onGuardado` recibe el guardado (p. ej. para elegirlo en la guía). */
export function FichaTransportista({
  t,
  onClose,
  onGuardado,
}: {
  t: Transportista;
  onClose: () => void;
  onGuardado?: (t: Transportista) => void;
}) {
  const router = useRouter();
  const [ruc, setRuc] = useState(t.ruc);
  const [razon, setRazon] = useState(t.razon_social);
  const [placa, setPlaca] = useState(t.placa ?? "");
  const [licencia, setLicencia] = useState(t.licencia ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarTransportista({ id: t.id || undefined, ruc, razon_social: razon, placa, licencia });
      if (!r.ok) return setError(r.error);
      onGuardado?.({ id: r.data, ruc, razon_social: razon, placa: placa || null, licencia: licencia || null });
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={t.id ? t.razon_social : "Nuevo transportista"}
      footer={
        <Button size="lg" onClick={guardar} disabled={pending}>
          Guardar
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="RUC">
          <Input value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={11} className="num" />
        </Field>
        <Field label="Razón social">
          <Input value={razon} onChange={(e) => setRazon(e.target.value.toUpperCase())} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placa">
            <Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} className="num" />
          </Field>
          <Field label="N° licencia">
            <Input value={licencia} onChange={(e) => setLicencia(e.target.value.toUpperCase())} className="num" />
          </Field>
        </div>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
