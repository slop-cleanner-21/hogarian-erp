"use client";

import { ImagePlus, Mic, MicOff, SendHorizontal, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/format";
import { inputClass } from "./ui/field";
import { Sheet } from "./ui/sheet";

// Asistente (fase 1: Tesorería). Lee y filtra; habla, escribe o manda fotos. La conversación queda en la pestaña
// (sessionStorage) mientras se navega.
type Turno = { rol: "usuario" | "asistente"; texto: string; fotos?: number };
type Foto = { media_type: "image/jpeg"; data: string; url: string };

const CLAVE = "prod1_asistente";
const MAX_FOTOS = 3;
// La API lee hasta ~1568 px por lado; más grande solo pesa (y Vercel corta los pedidos de más de 4.5 MB).
const LADO = 1568;

/** Rutas donde está el asistente (por ahora, Tesorería; la ruta del servidor también exige el rol). */
const disponible = (path: string) => path === "/tesoreria" || path.startsWith("/tesoreria/");

export function BotonAsistente() {
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  if (!disponible(path)) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Asistente"
        onClick={() => setAbierto(true)}
        className="flex h-12 w-11 shrink-0 items-center justify-center rounded-control text-primary active:bg-ink/8"
      >
        <Sparkles size={22} />
      </button>
      {abierto && <HojaAsistente onClose={() => setAbierto(false)} />}
    </>
  );
}

function leer(): Turno[] {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]") as Turno[];
  } catch {
    return [];
  }
}

/** La foto achicada a JPEG (base64 sin el prefijo), para no mandar megas desde el celular. */
async function achicar(archivo: File): Promise<Foto> {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, LADO / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
}

// Dictado del navegador (Chrome y Edge; en Android, el teclado también dicta). No todos lo tienen: sin él no hay botón.
type Reconocimiento = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const Dictado = () =>
  (globalThis as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento })
    .SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: new () => Reconocimiento }).webkitSpeechRecognition;

function HojaAsistente({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [escuchando, setEscuchando] = useState(false);
  const [hayDictado, setHayDictado] = useState(false);
  const dictado = useRef<Reconocimiento | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const fin = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage y el dictado solo existen en el navegador */
  useEffect(() => {
    setTurnos(leer());
    setHayDictado(!!Dictado());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(turnos.slice(-20)));
    } catch {}
    fin.current?.scrollIntoView({ block: "end" });
  }, [turnos, pending]);
  useEffect(() => () => dictado.current?.stop(), []);

  const escuchar = () => {
    if (escuchando) return dictado.current?.stop();
    const R = Dictado();
    if (!R) return;
    const r = new R();
    r.lang = "es-PE";
    r.interimResults = false;
    r.continuous = false;
    const antes = texto ? `${texto.trimEnd()} ` : "";
    r.onresult = (e) => {
      let dicho = "";
      for (let i = 0; i < e.results.length; i++) dicho += e.results[i][0].transcript;
      setTexto(antes + dicho);
    };
    r.onerror = (e) => e.error !== "no-speech" && e.error !== "aborted" && setError("No se pudo usar el micrófono");
    r.onend = () => setEscuchando(false);
    dictado.current = r;
    setError(null);
    setEscuchando(true);
    r.start();
  };

  const agregar = async (archivos: File[]) => {
    const imagenes = archivos.filter((a) => a.type.startsWith("image/")).slice(0, MAX_FOTOS - fotos.length);
    try {
      const nuevas = await Promise.all(imagenes.map(achicar));
      setFotos((f) => [...f, ...nuevas].slice(0, MAX_FOTOS));
    } catch {
      setError("No se pudo leer la foto");
    }
  };

  const enviar = () => {
    const t = texto.trim();
    if ((!t && !fotos.length) || pending) return;
    dictado.current?.stop();
    const historial = turnos.map(({ rol, texto }) => ({ rol, texto }));
    const pregunta: Turno = { rol: "usuario", texto: t, ...(fotos.length ? { fotos: fotos.length } : {}) };
    setTurnos((ts) => [...ts, pregunta]);
    setTexto("");
    const imagenes = fotos.map(({ media_type, data }) => ({ media_type, data }));
    setFotos([]);
    setError(null);
    startTransition(async () => {
      const qs = window.location.search.slice(1);
      const res = await fetch("/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: t, historial, imagenes, pantalla: qs ? `${path}?${qs}` : path }),
      }).catch(() => null);
      const r = (await res?.json().catch(() => null)) as { texto?: string; navegar?: string | null; error?: string } | null;
      if (!res?.ok || !r?.texto) {
        setError(r?.error ?? "No hubo respuesta");
        return;
      }
      setTurnos((ts) => [...ts, { rol: "asistente", texto: r.texto! }]);
      // Solo rutas de la app (las arma el servidor; igual se revisa).
      if (r.navegar && /^\/tesoreria(\/consultas)?\?[\w%=&,.\-*]*$/.test(r.navegar)) {
        router.push(r.navegar);
        onClose();
      }
    });
  };

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Asistente"
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-danger">{error}</p>}
          {fotos.length > 0 && (
            <ul className="flex gap-2">
              {fotos.map((f, i) => (
                <li key={f.url.slice(-24)} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local */}
                  <img src={f.url} alt={`Foto ${i + 1}`} className="h-16 w-16 rounded-field border border-line object-cover" />
                  <button
                    type="button"
                    aria-label={`Quitar foto ${i + 1}`}
                    onClick={() => setFotos((fs) => fs.filter((x) => x !== f))}
                    className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-bg">
                      <X size={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-1">
            <input
              ref={archivo}
              type="file"
              hidden
              multiple
              accept="image/*"
              aria-label="Fotos"
              onChange={(e) => {
                void agregar([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Adjuntar foto"
              disabled={fotos.length >= MAX_FOTOS || pending}
              onClick={() => archivo.current?.click()}
              className="flex h-12 w-11 shrink-0 items-center justify-center rounded-control text-ink-2 active:bg-ink/8 disabled:opacity-40"
            >
              <ImagePlus size={22} />
            </button>
            {hayDictado && (
              <button
                type="button"
                aria-label={escuchando ? "Dejar de escuchar" : "Hablar"}
                aria-pressed={escuchando}
                onClick={escuchar}
                disabled={pending}
                className={cn(
                  "flex h-12 w-11 shrink-0 items-center justify-center rounded-control active:bg-ink/8 disabled:opacity-40",
                  escuchando ? "text-danger" : "text-ink-2",
                )}
              >
                {escuchando ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
            )}
            <textarea
              data-autofocus
              aria-label="Mensaje"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={escuchando ? "Escuchando…" : "Pregunta o pide"}
              className={cn(inputClass, "field-sizing-content max-h-32 min-h-12 flex-1 resize-none py-2.5")}
            />
            <button
              type="button"
              aria-label="Enviar"
              onClick={enviar}
              disabled={pending || (!texto.trim() && !fotos.length)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary text-primary-ink disabled:opacity-40"
            >
              <SendHorizontal size={20} />
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {turnos.map((t, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-panel px-3 py-2 text-[16px] leading-snug",
              t.rol === "usuario" ? "self-end bg-primary text-primary-ink" : "self-start bg-sunken text-ink",
            )}
          >
            {t.fotos ? <span className="block text-[13px] opacity-80">{t.fotos === 1 ? "1 foto" : `${t.fotos} fotos`}</span> : null}
            {t.texto}
          </div>
        ))}
        {pending && (
          <div role="status" aria-label="Pensando" className="self-start rounded-panel bg-sunken px-3 py-2 text-ink-3">
            …
          </div>
        )}
        <div ref={fin} />
      </div>
    </Sheet>
  );
}
