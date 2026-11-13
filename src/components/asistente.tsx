"use client";

import { ChevronDown, ChevronUp, ImagePlus, ListFilter, Mic, SendHorizontal, Square, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/format";
import { destinoValido, historialDe, MAX_TURNOS } from "@/lib/asistente/urls";
import { inputClass } from "./ui/field";

// Hogariano, el asistente (fase 1: Tesorería). Un panel abajo que no tapa la app (como el de Gemini en Android): compacto, con la
// última respuesta y el campo; se agranda a media pantalla para ver la conversación o una respuesta larga. Vive en el
// layout de Tesorería: sigue abierto al navegar, y la pantalla de arriba se usa como siempre. Su destello es la luz de
// estado: quieto, girando mientras piensa, latiendo mientras escucha (animaciones en globals.css, «.hog-*»).
type Turno = { rol: "usuario" | "asistente"; texto: string; fotos?: number; filtro?: boolean };
type Foto = { media_type: "image/jpeg"; data: string; url: string };
type Estado = "quieto" | "pensando" | "escuchando";

const CLAVE = "prod1_asistente";
const ABIERTO = "prod1_asistente_abierto";
/** El botón de la barra abre o cierra el panel. */
const ALTERNAR = "prod1:asistente";
/** El panel avisa al botón si está abierto y qué hace (para marcarlo y animar su destello). */
const ESTADO = "prod1:asistente-estado";
type Aviso = { abierto: boolean; estado: Estado };
// El último aviso, para el botón que se monta después (la barra se vuelve a montar al navegar).
let ultimoAviso: Aviso = { abierto: false, estado: "quieto" };
const MAX_FOTOS = 3;
// La API lee hasta ~1568 px por lado; más grande solo pesa (y Vercel corta los pedidos de más de 4.5 MB).
const LADO = 1568;
// Cada foto, hasta ~0.9 MB (en base64): tres caben holgadas bajo ese tope.
const MAX_BASE64 = 1_200_000;
// Una respuesta más larga que esto abre el panel a media pantalla.
const LARGA = 220;

/** Rutas donde está el asistente (por ahora, Tesorería; la ruta del servidor también exige el rol). */
const disponible = (path: string) => path === "/tesoreria" || path.startsWith("/tesoreria/");

/** El ícono de Hogariano: un destello de rayos de distinto largo, en su coral. */
export function IconoHogariano({ size = 22, className, estado = "quieto" }: { size?: number; className?: string; estado?: Estado }) {
  // 12 rayos alrededor del centro, alternando largos (como un destello dibujado a mano).
  const rayos = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6 + 0.12;
    const largo = i % 3 === 0 ? 10.5 : i % 3 === 1 ? 8 : 9.2;
    const r0 = 2.6;
    return `M${(12 + r0 * Math.cos(a)).toFixed(2)} ${(12 + r0 * Math.sin(a)).toFixed(2)}L${(12 + largo * Math.cos(a)).toFixed(2)} ${(12 + largo * Math.sin(a)).toFixed(2)}`;
  }).join("");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("text-hogariano", estado === "pensando" && "hog-pensando", estado === "escuchando" && "hog-escuchando", className)}
    >
      <path d={rayos} stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Botón de la barra superior: abre o cierra el panel (que está en el layout). Marcado mientras está abierto. */
export function BotonAsistente() {
  const path = usePathname();
  const [estado, setEstado] = useState<Aviso>({ abierto: false, estado: "quieto" });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el estado del panel llega por evento del navegador
    setEstado(ultimoAviso);
    const oir = (e: Event) => setEstado((e as CustomEvent<Aviso>).detail);
    window.addEventListener(ESTADO, oir);
    return () => window.removeEventListener(ESTADO, oir);
  }, []);
  if (!disponible(path)) return null;
  return (
    <button
      type="button"
      aria-label="Hogariano"
      aria-pressed={estado.abierto}
      onClick={() => window.dispatchEvent(new Event(ALTERNAR))}
      className={cn(
        "flex h-12 w-11 shrink-0 items-center justify-center rounded-control transition-colors active:bg-ink/8",
        estado.abierto && "bg-hogariano/12",
      )}
    >
      <IconoHogariano estado={estado.estado} />
    </button>
  );
}

function leer(): Turno[] {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]") as Turno[];
  } catch {
    return [];
  }
}
function guardar(turnos: Turno[]) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(turnos.slice(-MAX_TURNOS)));
  } catch {}
}
function recordarAbierto(v: boolean) {
  try {
    sessionStorage.setItem(ABIERTO, v ? "1" : "");
  } catch {}
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
  // Menos calidad hasta que quepa (una foto real queda en la primera; un escaneo con mucho detalle, en las siguientes).
  let url = "";
  for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
    url = canvas.toDataURL("image/jpeg", calidad);
    if (url.length - url.indexOf(",") - 1 <= MAX_BASE64) break;
  }
  const data = url.slice(url.indexOf(",") + 1);
  if (data.length > MAX_BASE64) throw new Error("foto muy pesada");
  return { media_type: "image/jpeg", data, url };
}

// Dictado del navegador (Chrome y Edge; Chrome manda el audio a Google). Pide HTTPS (o localhost): sin él no hay botón.
type Reconocimiento = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const Dictado = () => {
  const g = globalThis as unknown as {
    SpeechRecognition?: new () => Reconocimiento;
    webkitSpeechRecognition?: new () => Reconocimiento;
    isSecureContext?: boolean;
  };
  return g.isSecureContext ? (g.SpeechRecognition ?? g.webkitSpeechRecognition) : undefined;
};
const ERRORES_DICTADO: Record<string, string> = {
  "not-allowed": "Permite el micrófono para esta app en el navegador",
  "service-not-allowed": "Permite el micrófono para esta app en el navegador",
  "audio-capture": "No se encontró el micrófono",
  network: "El dictado necesita internet",
};
const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** El panel. Va en el layout de las pantallas que tienen el asistente. */
export function PanelAsistente() {
  const router = useRouter();
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [grande, setGrande] = useState(false);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [escuchando, setEscuchando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [hayDictado, setHayDictado] = useState(false);
  const dictado = useRef<Reconocimiento | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const fin = useRef<HTMLDivElement>(null);
  const estado: Estado = escuchando ? "escuchando" : pending ? "pensando" : "quieto";

  const cerrar = useCallback(() => {
    setAbierto(false);
    recordarAbierto(false);
    dictado.current?.stop();
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage y el dictado solo existen en el navegador */
  useEffect(() => {
    setTurnos(leer());
    setHayDictado(!!Dictado());
    try {
      setAbierto(sessionStorage.getItem(ABIERTO) === "1");
    } catch {}
  }, []);
  // El contador de la grabación.
  useEffect(() => {
    if (!escuchando) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [escuchando]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const alternar = () =>
      setAbierto((a) => {
        recordarAbierto(!a);
        return !a;
      });
    window.addEventListener(ALTERNAR, alternar);
    return () => window.removeEventListener(ALTERNAR, alternar);
  }, []);
  useEffect(() => {
    ultimoAviso = { abierto: abierto && disponible(path), estado };
    window.dispatchEvent(new CustomEvent(ESTADO, { detail: ultimoAviso }));
  }, [abierto, estado, path]);
  useEffect(() => {
    if (abierto) campo.current?.focus({ preventScroll: true });
  }, [abierto]);
  useEffect(() => {
    guardar(turnos);
    fin.current?.scrollIntoView({ block: "end" });
  }, [turnos, pending, grande]);
  useEffect(() => () => dictado.current?.stop(), []);

  if (!disponible(path) || !abierto) return null;

  const escuchar = () => {
    if (escuchando) return dictado.current?.stop();
    const R = Dictado();
    if (!R) return;
    const r = new R();
    r.lang = "es-PE";
    r.interimResults = true;
    r.continuous = false;
    const antes = texto ? `${texto.trimEnd()} ` : "";
    r.onresult = (e) => {
      let dicho = "";
      for (let i = 0; i < e.results.length; i++) dicho += e.results[i][0].transcript;
      setTexto(antes + dicho);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORES_DICTADO[e.error] ?? "No se pudo usar el micrófono");
    };
    r.onend = () => setEscuchando(false);
    dictado.current = r;
    setError(null);
    try {
      r.start();
      setEscuchando(true);
    } catch {
      setError("No se pudo usar el micrófono");
    }
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
    const historial = historialDe(turnos);
    const pregunta: Turno = { rol: "usuario", texto: t, ...(fotos.length ? { fotos: fotos.length } : {}) };
    const conPregunta = [...turnos, pregunta];
    setTurnos(conPregunta);
    setTexto("");
    const imagenes = fotos.map(({ media_type, data }) => ({ media_type, data }));
    setFotos([]);
    setError(null);
    startTransition(async () => {
      const res = await fetch("/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: t, historial, imagenes, pantalla: path + window.location.search }),
      }).catch(() => null);
      const r = (await res?.json().catch(() => null)) as { texto?: string; navegar?: string | null; error?: string } | null;
      if (!res?.ok || !r?.texto) {
        setError(r?.error ?? "No hubo respuesta");
        return;
      }
      const filtro = !!r.navegar && destinoValido(r.navegar);
      setTurnos([...conPregunta, { rol: "asistente", texto: r.texto, ...(filtro ? { filtro } : {}) }]);
      if (filtro) {
        // Filtró la pantalla: el panel queda compacto para que se vea el resultado.
        setGrande(false);
        router.push(r.navegar!);
      } else if (r.texto.length > LARGA || r.texto.split("\n").length > 3) {
        setGrande(true);
      }
    });
  };

  const ultima = [...turnos].reverse().find((t) => t.rol === "asistente");

  return (
    <>
      {/* Lo que ocupa el panel compacto, para que se pueda llegar al final de la lista de arriba. */}
      <div aria-hidden className="h-40" />
      <section
        aria-label="Hogariano"
        aria-busy={pending}
        onKeyDown={(e) => e.key === "Escape" && cerrar()}
        className={cn(
          "panel-hogariano fixed inset-x-0 bottom-0 z-40 mx-auto flex h-auto max-w-2xl flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-line bg-surface",
          "pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-12px_rgb(0_0_0/0.4)]",
          grande && "h-[55dvh]",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 pl-3 pr-1">
          <IconoHogariano size={20} estado={estado} className="shrink-0" />
          <span className="rotulo text-[17px] font-semibold">Hogariano</span>
          <button
            type="button"
            onClick={() => setGrande((g) => !g)}
            aria-label={grande ? "Achicar" : "Agrandar"}
            aria-expanded={grande}
            className="flex h-11 flex-1 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
          >
            {grande ? <ChevronDown size={22} /> : <ChevronUp size={22} />}
          </button>
          <button
            type="button"
            aria-label="Cerrar Hogariano"
            onClick={cerrar}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control active:bg-ink/8"
          >
            <X size={20} />
          </button>
        </div>

        {grande ? (
          <div aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pb-2">
            {turnos.map((t, i) => (
              <Burbuja key={i} turno={t} nueva={i === turnos.length - 1} />
            ))}
            {pending && <Pensando />}
            <div ref={fin} />
          </div>
        ) : pending ? (
          <div className="flex px-3 pb-2">
            <Pensando />
          </div>
        ) : (
          ultima && (
            <button
              type="button"
              aria-live="polite"
              onClick={() => setGrande(true)}
              className="hog-entra mx-3 mb-2 flex min-w-0 items-start gap-2 rounded-panel bg-sunken px-3 py-2 text-left text-[15px] leading-snug text-ink"
            >
              {ultima.filtro && <ListFilter size={16} aria-label="Filtró la pantalla" className="mt-0.5 shrink-0 text-primary" />}
              <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{ultima.texto.replace(/\s*\n\s*/g, " ")}</span>
            </button>
          )
        )}

        {error && (
          <p role="alert" className="hog-entra mx-3 mb-2 rounded-field bg-danger-bg px-3 py-2 text-[15px] leading-snug text-danger [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        {fotos.length > 0 && (
          <ul aria-label="Fotos adjuntas" className="flex shrink-0 gap-3 overflow-x-auto px-3 pb-2 pt-2">
            {fotos.map((f, i) => (
              <li key={f.url.slice(-24)} className="hog-entra relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local */}
                <img src={f.url} alt={`Foto ${i + 1}`} className="h-14 w-14 rounded-field border border-line object-cover" />
                <button
                  type="button"
                  aria-label={`Quitar foto ${i + 1}`}
                  onClick={() => setFotos((fs) => fs.filter((x) => x !== f))}
                  className="absolute -right-2.5 -top-2.5 flex h-8 w-8 items-center justify-center"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-bg">
                    <X size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Grabando: franja con las barras y el tiempo, para que se note que el micrófono está abierto. */}
        {escuchando && (
          <div role="status" className="hog-entra flex h-8 shrink-0 items-center gap-2 px-4 text-[14px] font-medium text-hogariano">
            <span aria-hidden className="hog-barras flex h-4 items-center gap-[3px]">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="num">{reloj(segundos)}</span>
            <span className="sr-only">Escuchando</span>
          </div>
        )}

        <div className="flex shrink-0 items-end gap-1 px-2">
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
            disabled={fotos.length >= MAX_FOTOS || pending || escuchando}
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
                "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
                escuchando ? "hog-anillo bg-hogariano text-white" : "text-ink-2 active:bg-ink/8",
              )}
            >
              {escuchando ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <Mic size={22} />}
            </button>
          )}
          <textarea
            ref={campo}
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
            placeholder={escuchando ? "Te escucho…" : "Pregunta o pide"}
            className={cn(
              inputClass,
              "field-sizing-content h-auto max-h-28 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto py-2.5 transition-colors [overflow-wrap:anywhere]",
              escuchando && "border-hogariano ring-1 ring-hogariano",
            )}
          />
          <button
            type="button"
            aria-label="Enviar"
            onClick={enviar}
            disabled={pending || (!texto.trim() && !fotos.length)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary text-primary-ink transition-opacity disabled:opacity-40"
          >
            <SendHorizontal size={20} />
          </button>
        </div>
      </section>
    </>
  );
}

function Burbuja({ turno: t, nueva }: { turno: Turno; nueva: boolean }) {
  return (
    <div
      className={cn(
        "max-w-[85%] min-w-0 whitespace-pre-wrap rounded-panel px-3 py-2 text-[16px] leading-snug [overflow-wrap:anywhere]",
        t.rol === "usuario" ? "self-end rounded-br-md bg-primary text-primary-ink" : "self-start rounded-bl-md bg-sunken text-ink",
        nueva && "hog-entra",
      )}
    >
      {t.fotos ? <span className="block text-[13px] opacity-80">{t.fotos === 1 ? "1 foto" : `${t.fotos} fotos`}</span> : null}
      {t.filtro && <ListFilter size={15} aria-label="Filtró la pantalla" className="mb-0.5 inline-block align-[-2px] text-primary" />}
      {t.filtro ? " " : null}
      {t.texto}
    </div>
  );
}

function Pensando() {
  return (
    <div role="status" className="hog-entra flex items-center self-start rounded-panel rounded-bl-md bg-sunken px-3 py-2.5">
      <IconoHogariano size={20} estado="pensando" />
      <span className="sr-only">Pensando</span>
    </div>
  );
}
