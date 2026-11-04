"use client";

import { Camera, FileText, Upload } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { registrarAdjunto } from "@/app/documentos/actions";
import type { AdjuntoFirmado, TipoAdjunto } from "@/lib/adjuntos";
import { cn } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { EnlaceArchivo, useVisor } from "./visor";

export const ADJUNTO_LABEL: Record<TipoAdjunto, string> = {
  CONTRATO: "Contrato firmado",
  GUIA: "Guía de remisión",
  FOTO: "Fotografías",
  VOUCHER: "Voucher",
};

const ACCEPT: Record<TipoAdjunto, string> = {
  CONTRATO: "application/pdf,image/*",
  GUIA: "application/pdf,image/*,text/xml",
  FOTO: "image/*",
  VOUCHER: "application/pdf,image/*",
};

/** Documentos del expediente que no son obligatorios (por ahora). */
const OPCIONALES = new Set<TipoAdjunto>(["GUIA"]);

const limpiar = (nombre: string) => nombre.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);

/** Sube archivos al bucket `documentos` y devuelve sus rutas. */
export async function subirArchivos(carpeta: string, archivos: File[]) {
  const storage = createClient().storage.from("documentos");
  const subidos: { path: string; nombre: string; mime: string }[] = [];
  for (const f of archivos) {
    const path = `${carpeta}/${Date.now()}-${limpiar(f.name)}`;
    const { error } = await storage.upload(path, f, { contentType: f.type || undefined });
    if (error) throw new Error(error.message);
    subidos.push({ path, nombre: f.name, mime: f.type || "" });
  }
  return subidos;
}

/**
 * Documentos de una orden agrupados por tipo. `tipos` define qué grupos se muestran y
 * `subir` cuáles puede subir el usuario actual.
 */
export function Documentos({
  obraId,
  numeroOc,
  adjuntos,
  tipos,
  subir,
  onSubido,
  opcionales = [],
}: {
  obraId: number;
  numeroOc: string;
  adjuntos: AdjuntoFirmado[];
  tipos: TipoAdjunto[];
  subir: TipoAdjunto[];
  /** Tipos que en este caso no hacen falta (p. ej. el contrato de una OS histórica): sin «Falta». */
  opcionales?: TipoAdjunto[];
  /** Si la lista se cargó en el cliente, el padre la recarga aquí. */
  onSubido?: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-panel bg-surface">
      {tipos.map((t) => (
        <GrupoDocumentos
          key={t}
          tipo={t}
          obraId={obraId}
          numeroOc={numeroOc}
          archivos={adjuntos.filter((a) => a.tipo === t)}
          puedeSubir={subir.includes(t)}
          opcional={opcionales.includes(t)}
          onSubido={onSubido}
        />
      ))}
    </section>
  );
}

function GrupoDocumentos({
  tipo,
  obraId,
  numeroOc,
  archivos,
  puedeSubir,
  opcional = false,
  onSubido,
}: {
  tipo: TipoAdjunto;
  obraId: number;
  numeroOc: string;
  archivos: AdjuntoFirmado[];
  puedeSubir: boolean;
  opcional?: boolean;
  onSubido?: () => void;
}) {
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const foto = tipo === "FOTO";
  const visor = useVisor();

  const onFiles = (files: FileList | null) => {
    if (!files?.length || tipo === "VOUCHER") return;
    const lista = [...files];
    startTransition(async () => {
      setError(null);
      try {
        const subidos = await subirArchivos(`${obraId}/${numeroOc}/${tipo}`, lista);
        for (const s of subidos) {
          const r = await registrarAdjunto({ tipo, obraId, numeroOc, path: s.path, nombre: s.nombre, mime: s.mime }, path);
          if (!r.ok) throw new Error(r.error);
        }
        onSubido?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  };

  return (
    <div className="border-b border-line px-4 py-3 last:border-0">
      {visor.elemento}
      <div className="flex min-h-11 items-center gap-3">
        <span className={cn("flex-1 font-medium", archivos.length === 0 && "text-ink-2")}>{ADJUNTO_LABEL[tipo]}</span>
        {archivos.length === 0 &&
          !puedeSubir &&
          (OPCIONALES.has(tipo) || opcional ? (
            <span className="text-sm text-ink-3">—</span>
          ) : (
            <span className="text-sm font-semibold text-warn">Falta</span>
          ))}
        {puedeSubir && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              multiple={foto}
              accept={ACCEPT[tipo]}
              capture={foto ? "environment" : undefined}
              onChange={(e) => onFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => input.current?.click()}
              className="flex h-11 items-center gap-1.5 rounded-control border border-line px-3 text-[15px] font-semibold active:bg-sunken disabled:opacity-50"
            >
              {foto ? <Camera size={18} /> : <Upload size={18} />}
              {pending ? "Subiendo…" : "Subir"}
            </button>
          </>
        )}
      </div>
      {foto && archivos.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {archivos.map((a, i) => (
            <li key={a.id}>
              <button type="button" onClick={() => visor.abrir(archivos.map((x) => ({ url: x.url, alt: x.nombre })), i)} aria-label={`Ver ${a.nombre}`} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage local */}
                <img src={a.url} alt={a.nombre} loading="lazy" className="aspect-square w-full rounded-field object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!foto && archivos.length > 0 && (
        <ul className="mt-1">
          {archivos.map((a) => (
            <li key={a.id}>
              <EnlaceArchivo
                href={a.url}
                nombre={a.nombre}
                className="flex min-h-11 w-full items-center gap-2 text-[15px] text-primary underline-offset-2 active:underline"
              >
                <FileText size={17} className="shrink-0" />
                <span className="truncate">{a.nombre}</span>
              </EnlaceArchivo>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
