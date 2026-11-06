"use client";

import { Lightbulb, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ClipboardEvent } from "react";
import { enviarSugerencia } from "@/app/sugerencias/actions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/format";
import { TIPOS_SUGERENCIA, type TipoSugerencia } from "@/lib/sugerencias";
import { Button } from "./ui/button";
import { Field, inputClass } from "./ui/field";
import { Sheet } from "./ui/sheet";
import { Faltan } from "./ui/faltan";

const MAX_CAPTURAS = 5;
const MAX_MB = 10;
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };

type Captura = { archivo: File; url: string };

/** Botón del encabezado: errores, mejoras y preferencias de diseño, con capturas. Lleva la pantalla y el link desde donde se escribe. */
export function BotonSugerencia() {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Sugerencias"
        onClick={() => setAbierta(true)}
        className="flex h-12 w-11 shrink-0 items-center justify-center rounded-control active:bg-ink/8"
      >
        <Lightbulb size={22} />
      </button>
      {abierta && <HojaSugerencia onClose={() => setAbierta(false)} />}
    </>
  );
}

function HojaSugerencia({ onClose }: { onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoSugerencia>("ERROR");
  const [texto, setTexto] = useState("");
  const [capturas, setCapturas] = useState<Captura[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);
  const [pending, startTransition] = useTransition();
  const archivoRef = useRef<HTMLInputElement>(null);
  // La pantalla y el link desde donde se abrió: el título sin el nombre de la app.
  const [origen] = useState(() => ({
    pantalla: document.title.split(" | ")[0],
    ruta: `${window.location.pathname}${window.location.search}`,
  }));

  // Al cerrar se liberan las vistas previas.
  const vistas = useRef<Captura[]>([]);
  useEffect(() => {
    vistas.current = capturas;
  }, [capturas]);
  useEffect(() => () => vistas.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const agregar = (archivos: File[]) => {
    setError(null);
    const imagenes = archivos.filter((a) => a.type in EXTENSION);
    if (imagenes.length < archivos.length) setError("Solo imágenes");
    if (imagenes.some((a) => a.size > MAX_MB * 1024 * 1024)) return setError(`Cada captura, hasta ${MAX_MB} MB`);
    if (capturas.length + imagenes.length > MAX_CAPTURAS) return setError(`Hasta ${MAX_CAPTURAS} capturas`);
    setCapturas([...capturas, ...imagenes.map((archivo) => ({ archivo, url: URL.createObjectURL(archivo) }))]);
  };
  const quitar = (c: Captura) => {
    URL.revokeObjectURL(c.url);
    setCapturas(capturas.filter((x) => x !== c));
  };
  // En la computadora, una captura se puede pegar directo.
  const pegar = (e: ClipboardEvent) => {
    const archivos = [...e.clipboardData.files];
    if (archivos.length) {
      e.preventDefault();
      agregar(archivos);
    }
  };

  const enviar = () =>
    startTransition(async () => {
      setError(null);
      const supabase = createClient();
      const { data } = await supabase.auth.getClaims();
      const uid = data?.claims?.sub;
      if (!uid) return setError("Vuelve a iniciar sesión");
      const rutas: string[] = [];
      for (const [i, c] of capturas.entries()) {
        const ruta = `${uid}/${Date.now()}-${i}.${EXTENSION[c.archivo.type]}`;
        const { error: e } = await supabase.storage.from("sugerencias").upload(ruta, c.archivo, { contentType: c.archivo.type });
        if (e) return setError(e.message);
        rutas.push(ruta);
      }
      const e = await enviarSugerencia({ tipo, texto, pantalla: origen.pantalla, ruta: origen.ruta, capturas: rutas });
      if (e) return setError(e);
      setEnviada(true);
    });

  if (enviada) {
    return (
      <Sheet open onClose={onClose} title="Sugerencia">
        <div className="flex flex-col gap-4 p-4">
          <p role="status" className="text-[17px] font-semibold text-ok">¡Gracias! Ya le llegó al administrador</p>
          <Button size="lg" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Sugerencia"
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-danger">{error}</p>}
          <Faltan items={[texto.trim().length < 3 && "detalle"]} />
          <Button size="lg" onClick={enviar} disabled={pending || texto.trim().length < 3}>
            {pending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4" onPaste={pegar}>
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-3 gap-1 rounded-control bg-sunken p-1">
          {TIPOS_SUGERENCIA.map((t) => (
            <button
              key={t.valor}
              type="button"
              role="radio"
              aria-checked={tipo === t.valor}
              onClick={() => setTipo(t.valor)}
              className={cn("h-11 rounded-control text-[15px] font-medium", tipo === t.valor ? "bg-surface shadow-sm" : "text-ink-2")}
            >
              {t.corto}
            </button>
          ))}
        </div>
        <Field label="Detalle">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={2000} className={cn(inputClass, "h-auto py-3")} />
        </Field>
        <input
          ref={archivoRef}
          type="file"
          hidden
          multiple
          aria-label="Capturas"
          accept="image/*"
          onChange={(e) => {
            agregar([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        {capturas.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {capturas.map((c, i) => (
              <li key={c.url} className="relative overflow-hidden rounded-field border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local del archivo elegido */}
                <img src={c.url} alt={`Captura ${i + 1}`} className="h-24 w-full object-cover" />
                <button
                  type="button"
                  aria-label={`Quitar captura ${i + 1}`}
                  onClick={() => quitar(c)}
                  className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-bg">
                    <X size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {capturas.length < MAX_CAPTURAS && (
          <button type="button" onClick={() => archivoRef.current?.click()} className={cn(inputClass, "flex items-center gap-2 text-left text-ink-3")}>
            <Paperclip size={18} className="shrink-0" />
            <span>Adjuntar captura</span>
          </button>
        )}
        <p className="truncate text-[14px] text-ink-3">Desde: {origen.pantalla}</p>
      </div>
    </Sheet>
  );
}
