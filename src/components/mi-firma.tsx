"use client";

import { Camera, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { guardarFirmaEmpresa, guardarMiFirma, misFirmasEmpresa, verMiFirma, type FirmaEmpresa } from "@/app/firma/actions";
import { cn } from "@/lib/format";
import { Button } from "./ui/button";
import { inputClass } from "./ui/field";
import { Sheet } from "./ui/sheet";

/**
 * Gerencia: la firma que va en los contratos de las OS. Si firma por una o varias empresas (Admin › Empresas), una por empresa (cada
 * una con su sello); si no, la suya. El Admin ve las de todas las empresas.
 */
export function MiFirma({ onClose }: { onClose: () => void }) {
  const [empresas, setEmpresas] = useState<FirmaEmpresa[] | null | undefined>(undefined);
  useEffect(() => {
    misFirmasEmpresa().then((r) => setEmpresas(r.ok ? r.data : null));
  }, []);

  return (
    <Sheet open onClose={onClose} title="Mi firma">
      <div className="flex flex-col gap-5 p-4">
        {empresas === undefined ? (
          <p className="text-ink-3">Cargando…</p>
        ) : empresas?.length ? (
          empresas.map((e) => (
            <Bloque
              key={e.empresaId}
              titulo={e.empresa}
              actual={e.firma}
              guardar={(archivo) => {
                const form = new FormData();
                form.set("empresa", String(e.empresaId));
                form.set("firma", archivo);
                return guardarFirmaEmpresa(form);
              }}
            />
          ))
        ) : (
          <Personal />
        )}
      </div>
    </Sheet>
  );
}

function Personal() {
  const [actual, setActual] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    verMiFirma().then((r) => setActual(r.ok ? r.data : null));
  }, []);
  if (actual === undefined) return <p className="text-ink-3">Cargando…</p>;
  return (
    <Bloque
      actual={actual}
      guardar={(archivo) => {
        const form = new FormData();
        form.set("firma", archivo);
        return guardarMiFirma(form);
      }}
    />
  );
}

/** Una firma: la actual, cambiar la imagen y guardar. */
function Bloque({
  titulo,
  actual: inicial,
  guardar: enviar,
}: {
  titulo?: string;
  actual: string | null;
  guardar: (archivo: File) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [actual, setActual] = useState(inicial);
  const [nueva, setNueva] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardada, setGuardada] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const vista = useMemo(() => (nueva ? URL.createObjectURL(nueva) : null), [nueva]);
  useEffect(() => () => {
    if (vista) URL.revokeObjectURL(vista);
  }, [vista]);

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await enviar(nueva!);
      if (!r.ok) return setError(r.error);
      setActual(vista);
      setNueva(null);
      setGuardada(true);
    });

  const imagen = vista ?? actual;
  return (
    <section aria-label={titulo ? `Firma ${titulo}` : "Firma"} className="flex flex-col gap-2">
      {titulo && <h3 className="font-semibold">{titulo}</h3>}
      <div className="flex h-40 items-center justify-center rounded-field border border-line bg-white p-3">
        {imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa local o data URL
          <img src={imagen} alt={titulo ? `Firma ${titulo}` : "Firma"} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-ink-3">Sin firma</span>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        aria-label={titulo ? `Imagen de la firma ${titulo}` : "Imagen de la firma"}
        onChange={(e) => {
          setError(null);
          setGuardada(false);
          setNueva(e.target.files?.[0] ?? null);
          // Así se puede volver a elegir el mismo archivo.
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(inputClass, "flex flex-1 items-center gap-2 text-left", nueva ? "text-ink" : "text-ink-3")}
        >
          {nueva ? <Check size={18} className="shrink-0 text-ok" /> : <Camera size={18} className="shrink-0" />}
          <span className="truncate">{nueva ? nueva.name : actual ? "Cambiar imagen" : "Subir imagen"}</span>
        </button>
        {nueva && (
          <Button onClick={guardar} disabled={pending}>
            Guardar firma
          </Button>
        )}
      </div>
      {guardada && <p role="status" className="text-ok">Guardada</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </section>
  );
}
