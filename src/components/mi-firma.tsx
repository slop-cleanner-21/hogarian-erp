"use client";

import { Camera, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { guardarMiFirma, verMiFirma } from "@/app/firma/actions";
import { cn } from "@/lib/format";
import { Button } from "./ui/button";
import { inputClass } from "./ui/field";
import { Sheet } from "./ui/sheet";

/** Gerencia: la imagen de su firma, que va en los contratos de las OS. */
export function MiFirma({ onClose }: { onClose: () => void }) {
  const [actual, setActual] = useState<string | null | undefined>(undefined);
  const [nueva, setNueva] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const vista = useMemo(() => (nueva ? URL.createObjectURL(nueva) : null), [nueva]);
  useEffect(() => () => {
    if (vista) URL.revokeObjectURL(vista);
  }, [vista]);
  useEffect(() => {
    verMiFirma().then((r) => setActual(r.ok ? r.data : null));
  }, []);

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const form = new FormData();
      form.set("firma", nueva!);
      const r = await guardarMiFirma(form);
      if (!r.ok) return setError(r.error);
      setActual(vista);
      setNueva(null);
      onClose();
    });

  const imagen = vista ?? actual;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Mi firma"
      footer={
        <Button size="lg" onClick={guardar} disabled={pending || !nueva}>
          Guardar firma
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex h-40 items-center justify-center rounded-field border border-line bg-white p-3">
          {imagen ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local o data URL
            <img src={imagen} alt="Firma" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-ink-3">{actual === undefined ? "Cargando…" : "Sin firma"}</span>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            setError(null);
            setNueva(e.target.files?.[0] ?? null);
          }}
        />
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(inputClass, "flex items-center gap-2 text-left", nueva ? "text-ink" : "text-ink-3")}
        >
          {nueva ? <Check size={18} className="shrink-0 text-ok" /> : <Camera size={18} className="shrink-0" />}
          <span className="truncate">{nueva ? nueva.name : actual ? "Cambiar imagen" : "Subir imagen"}</span>
        </button>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
