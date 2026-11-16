"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  History,
  ImagePlus,
  Mic,
  SendHorizontal,
  Settings2,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { cn } from "@/lib/format";
import {
  AJUSTES_DEF,
  cuando,
  guardarAjustes,
  guardarChats,
  leerAjustes,
  leerChats,
  nuevoChat,
  pideEspacio,
  tituloDe,
  type Ajustes,
  type Guardado,
  type Turno,
} from "@/lib/asistente/chats";
import { abrirHoja } from "@/lib/asistente/hojas";
import { Accion, historialDe } from "@/lib/asistente/urls";
import { aplicar } from "./theme-switch";
import { inputClass } from "./ui/field";

// Hogariano, el asistente (Tesorería). Un panel abajo que no tapa la app (como el de Gemini en Android): compacto, con la
// última respuesta y el campo; se agranda solo cuando la respuesta no cabe (se mide) o trae tablas o subtítulos. Vive en el
// layout de Tesorería: sigue abierto al navegar. Cuando maneja la interfaz (filtra, abre una orden, cambia el tema, abre una
// hoja) se oculta para que se vea, con un aviso breve. Los chats quedan en el dispositivo, por usuario (lib/asistente/chats).
// Su destello es la luz de estado: quieto, con los rayos en ola mientras piensa, latiendo mientras escucha («.hog-*»).
type Foto = { media_type: "image/jpeg"; data: string; url: string };
type Estado = "quieto" | "pensando" | "escuchando";
type Vista = "chat" | "chats" | "ajustes";

const RespuestaMarkdown = dynamic(() => import("./asistente-markdown"), { ssr: false });
const cargarMarkdown = () => void import("./asistente-markdown");

const ABIERTO = "prod1_asistente_abierto";
/** Se ocultó solo, por una acción: al volver a abrirlo sigue el mismo chat (aunque el ajuste diga «nuevo»). */
const OCULTO = "prod1_asistente_oculto";
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
const TEMA = { claro: "light", oscuro: "dark", sistema: "system" } as const;
const HOJA: Record<string, string> = {
  menu: "Abrió el menú",
  diseno: "Abrió el diseño",
  filtros: "Abrió los filtros",
  sugerencia: "Abrió el formulario",
  ajustes_hogariano: "Abrió sus ajustes",
  chats: "Abrió los chats",
};

/** Rutas donde está el asistente (por ahora, Tesorería; la ruta del servidor también exige el rol). */
const disponible = (path: string) => path === "/tesoreria" || path.startsWith("/tesoreria/");

const sesion = {
  leer: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  poner: (k: string, v: string) => {
    try {
      if (v) sessionStorage.setItem(k, v);
      else sessionStorage.removeItem(k);
    } catch {}
  },
};

// 12 rayos alrededor del centro, alternando largos (como un destello dibujado a mano); cada uno es su propio trazo para
// animarlos en ola mientras piensa.
const RAYOS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6 + 0.12;
  const largo = i % 3 === 0 ? 10.5 : i % 3 === 1 ? 8 : 9.2;
  const r0 = 2.6;
  return `M${(12 + r0 * Math.cos(a)).toFixed(2)} ${(12 + r0 * Math.sin(a)).toFixed(2)}L${(12 + largo * Math.cos(a)).toFixed(2)} ${(12 + largo * Math.sin(a)).toFixed(2)}`;
});

/** El ícono de Hogariano: un destello de rayos de distinto largo, en su coral. */
export function IconoHogariano({ size = 22, className, estado = "quieto" }: { size?: number; className?: string; estado?: Estado }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("text-hogariano", estado === "pensando" && "hog-pensando", estado === "escuchando" && "hog-escuchando", className)}
    >
      <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" fill="none">
        {RAYOS.map((d, i) => (
          <path key={i} d={d} pathLength={1} className="hog-rayo" style={{ "--i": i } as CSSProperties} />
        ))}
      </g>
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

/** Lo que hizo en la interfaz, para marcar su respuesta en el chat. */
function hizoDe(acciones: Accion[]): string {
  const a = acciones[acciones.length - 1];
  if (a.tipo === "tema") return a.valor === "oscuro" ? "Modo oscuro" : a.valor === "claro" ? "Modo claro" : "Tema del sistema";
  if (a.tipo === "navegar") return a.url.startsWith("/tesoreria/pago/") ? "Abrió la orden" : "Filtró la pantalla";
  if (a.que === "avisos") return "Abrió los avisos";
  return HOJA[a.que] ?? "Abrió";
}

/** El panel. Va en el layout de las pantallas que tienen el asistente. */
export function PanelAsistente({ userId }: { userId: string }) {
  const router = useRouter();
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [grande, setGrande] = useState(false);
  const [vista, setVista] = useState<Vista>("chat");
  const [guardado, setGuardado] = useState<Guardado>({ actual: null, chats: [] });
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_DEF);
  const [cargado, setCargado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; n: number } | null>(null);
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [escuchando, setEscuchando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [hayDictado, setHayDictado] = useState(false);
  const [desborda, setDesborda] = useState(false);
  const dictado = useRef<Reconocimiento | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const fin = useRef<HTMLDivElement>(null);
  const previa = useRef<HTMLDivElement>(null);
  /** Una respuesta recién llegada: se mide si cabe en el panel pequeño. */
  const medir = useRef(false);
  const abiertoRef = useRef(false);
  const ajustesRef = useRef(ajustes);
  const actualRef = useRef<string | null>(null);
  const estado: Estado = escuchando ? "escuchando" : pending ? "pensando" : "quieto";
  const chat = guardado.chats.find((c) => c.id === guardado.actual) ?? null;
  const turnos = chat?.turnos ?? [];
  const alto = grande || vista !== "chat";

  useEffect(() => {
    abiertoRef.current = abierto;
    ajustesRef.current = ajustes;
    actualRef.current = guardado.actual;
  });

  const ocultar = useCallback((resumen: string | null) => {
    setAbierto(false);
    sesion.poner(ABIERTO, "");
    sesion.poner(OCULTO, "1");
    dictado.current?.stop();
    if (resumen) setAviso({ texto: resumen, n: Date.now() });
  }, []);

  const cerrar = useCallback(() => {
    setAbierto(false);
    sesion.poner(ABIERTO, "");
    sesion.poner(OCULTO, "");
    dictado.current?.stop();
  }, []);

  const empezarNuevo = useCallback(() => {
    setGuardado((g) => ({ ...g, actual: null }));
    setVista("chat");
    setGrande(false);
    setError(null);
    medir.current = false;
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- el almacenamiento y el dictado solo existen en el navegador */
  useEffect(() => {
    setGuardado(leerChats(userId));
    setAjustes(leerAjustes(userId));
    setCargado(true);
    setHayDictado(!!Dictado());
    setAbierto(sesion.leer(ABIERTO) === "1");
    // La conversación de antes (una sola, en la pestaña) ya no se usa.
    sesion.poner("prod1_asistente", "");
    cargarMarkdown();
  }, [userId]);
  // El contador de la grabación.
  useEffect(() => {
    if (!escuchando) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [escuchando]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (cargado) guardarChats(userId, guardado);
  }, [cargado, userId, guardado]);
  useEffect(() => {
    const alternar = () => {
      if (abiertoRef.current) return cerrar();
      // Al abrirlo el usuario: chat nuevo si así lo eligió, salvo que se haya ocultado solo (sigue lo que estaba haciendo).
      const porAccion = sesion.leer(OCULTO) === "1";
      sesion.poner(OCULTO, "");
      if (!porAccion && ajustesRef.current.abrir === "nuevo") empezarNuevo();
      setAviso(null);
      setAbierto(true);
      sesion.poner(ABIERTO, "1");
    };
    window.addEventListener(ALTERNAR, alternar);
    return () => window.removeEventListener(ALTERNAR, alternar);
  }, [cerrar, empezarNuevo]);
  useEffect(() => {
    ultimoAviso = { abierto: abierto && disponible(path), estado };
    window.dispatchEvent(new CustomEvent(ESTADO, { detail: ultimoAviso }));
  }, [abierto, estado, path]);
  useEffect(() => {
    if (abierto && vista === "chat") campo.current?.focus({ preventScroll: true });
  }, [abierto, vista]);
  useEffect(() => {
    if (alto && vista === "chat") fin.current?.scrollIntoView({ block: "end" });
  }, [turnos.length, pending, alto, vista]);
  useEffect(() => () => dictado.current?.stop(), []);
  // El aviso breve se va solo.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4200);
    return () => clearTimeout(t);
  }, [aviso]);
  // ¿La última respuesta cabe en el panel pequeño? Se mide lo que se ve (con su Markdown ya pintado): si no cabe y acaba de
  // llegar, se agranda solo; si no, se corta con un desvanecido (tocarla la agranda).
  const ultima = [...turnos].reverse().find((t) => t.rol === "asistente");
  useEffect(() => {
    const el = previa.current;
    if (!el) return;
    const revisar = () => {
      const no = el.scrollHeight > el.clientHeight + 1;
      setDesborda(no);
      if (no && medir.current) {
        medir.current = false;
        setGrande(true);
      }
    };
    const ro = new ResizeObserver(revisar);
    ro.observe(el);
    for (const h of el.children) ro.observe(h);
    revisar();
    const t = setTimeout(() => (medir.current = false), 2000);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [ultima, alto, abierto, pending]);

  if (!disponible(path)) return null;

  if (!abierto)
    return aviso ? (
      <button
        key={aviso.n}
        type="button"
        role="status"
        onClick={() => window.dispatchEvent(new Event(ALTERNAR))}
        className="hog-aviso fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-start gap-2 rounded-panel border border-line bg-surface px-3 py-2.5 text-left text-[15px] leading-snug shadow-[0_8px_24px_-10px_rgb(0_0_0/0.45)]"
      >
        <IconoHogariano size={18} className="mt-px shrink-0" />
        <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{aviso.texto}</span>
      </button>
    ) : null;

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

  /** Agrega turnos al chat `id` (si no existe, lo crea). */
  const agregarTurnos = (id: string, nuevos: Turno[]) =>
    setGuardado((g) => {
      const chats = g.chats.some((c) => c.id === id) ? g.chats : [{ ...nuevoChat(), id }, ...g.chats];
      return {
        ...g,
        chats: chats.map((c) => {
          if (c.id !== id) return c;
          const t = [...c.turnos, ...nuevos];
          return { ...c, turnos: t, titulo: c.titulo || tituloDe(t), actualizado: Date.now() };
        }),
      };
    });

  /** Lo que pidió hacer en la pantalla (validado otra vez aquí). Devuelve si el panel se ocultó. */
  const ejecutar = (acciones: Accion[], resumen: string): boolean => {
    let ocultarse = false;
    let destino: string | null = null;
    const hojas: string[] = [];
    for (const a of acciones) {
      if (a.tipo === "tema") {
        aplicar(TEMA[a.valor]);
        ocultarse = true;
      } else if (a.tipo === "navegar") {
        destino = a.url;
        ocultarse = true;
      } else if (a.que === "ajustes_hogariano" || a.que === "chats") {
        setVista(a.que === "chats" ? "chats" : "ajustes");
      } else if (a.que === "avisos") {
        destino = "/avisos";
        ocultarse = true;
      } else {
        hojas.push(a.que);
        ocultarse = true;
      }
    }
    if (destino) router.push(destino);
    if (ocultarse) ocultar(resumen);
    if (hojas.length) setTimeout(() => hojas.forEach(abrirHoja), destino ? 700 : 80);
    return ocultarse;
  };

  const enviar = () => {
    const t = texto.trim();
    if ((!t && !fotos.length) || pending) return;
    dictado.current?.stop();
    const id = chat?.id ?? nuevoChat().id;
    if (!chat) setGuardado((g) => ({ ...g, actual: id }));
    const historial = historialDe(turnos);
    agregarTurnos(id, [{ rol: "usuario", texto: t, ...(fotos.length ? { fotos: fotos.length } : {}) }]);
    setTexto("");
    const imagenes = fotos.map(({ media_type, data }) => ({ media_type, data }));
    setFotos([]);
    setError(null);
    setVista("chat");
    startTransition(async () => {
      const res = await fetch("/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: t, historial, imagenes, pantalla: path + window.location.search }),
      }).catch(() => null);
      const r = (await res?.json().catch(() => null)) as { texto?: string; acciones?: unknown[]; error?: string } | null;
      if (!res?.ok || !r?.texto) {
        setError(r?.error ?? "No hubo respuesta");
        return;
      }
      const acciones = (r.acciones ?? []).flatMap((a) => {
        const p = Accion.safeParse(a);
        return p.success ? [p.data] : [];
      });
      agregarTurnos(id, [{ rol: "asistente", texto: r.texto, ...(acciones.length ? { hizo: hizoDe(acciones) } : {}) }]);
      // Si mientras pensaba se cambió de chat, la respuesta queda en el suyo y no toca la pantalla.
      if (actualRef.current !== id) return;
      if (acciones.length && ejecutar(acciones, r.texto.replace(/[#*|_`>[\]()]/g, "").replace(/\s+/g, " ").trim())) return;
      if (pideEspacio(r.texto)) setGrande(true);
      else medir.current = true;
    });
  };

  const abrirEnlace = (url: string) => {
    router.push(url);
    ocultar(null);
  };

  const elegirChat = (id: string) => {
    setGuardado((g) => ({ ...g, actual: id }));
    setVista("chat");
    setGrande(true);
  };
  const borrarChat = (id: string) => setGuardado((g) => ({ actual: g.actual === id ? null : g.actual, chats: g.chats.filter((c) => c.id !== id) }));
  const ponerAjustes = (a: Ajustes) => {
    setAjustes(a);
    guardarAjustes(userId, a);
  };

  const titulo = vista === "chats" ? "Chats" : vista === "ajustes" ? "Ajustes" : "Hogariano";
  const chatsConAlgo = guardado.chats.filter((c) => c.turnos.length > 0);

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
          alto && "h-[60dvh]",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-1.5 pl-1 pr-1">
          {vista === "chat" ? (
            <span className="flex h-11 w-9 shrink-0 items-center justify-center">
              <IconoHogariano size={22} estado={estado} />
            </span>
          ) : (
            <button
              type="button"
              aria-label="Volver al chat"
              onClick={() => setVista("chat")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control active:bg-ink/8"
            >
              <ArrowLeft size={21} />
            </button>
          )}
          <span className="rotulo truncate text-[17px] font-semibold">{titulo}</span>
          {vista === "chat" ? (
            <button
              type="button"
              onClick={() => {
                medir.current = false;
                setGrande((g) => !g);
              }}
              aria-label={grande ? "Achicar" : "Agrandar"}
              aria-expanded={grande}
              className="flex h-11 min-w-8 flex-1 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
            >
              {grande ? <ChevronDown size={22} /> : <ChevronUp size={22} />}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          <BotonCabecera etiqueta="Nuevo chat" onClick={empezarNuevo} disabled={pending || (vista === "chat" && !turnos.length)}>
            <SquarePen size={19} />
          </BotonCabecera>
          <BotonCabecera etiqueta="Chats" activo={vista === "chats"} onClick={() => setVista((v) => (v === "chats" ? "chat" : "chats"))}>
            <History size={20} />
          </BotonCabecera>
          <BotonCabecera etiqueta="Ajustes de Hogariano" activo={vista === "ajustes"} onClick={() => setVista((v) => (v === "ajustes" ? "chat" : "ajustes"))}>
            <Settings2 size={20} />
          </BotonCabecera>
          <BotonCabecera etiqueta="Cerrar Hogariano" onClick={cerrar}>
            <X size={20} />
          </BotonCabecera>
        </div>

        {vista === "chats" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2">
            {chatsConAlgo.length === 0 ? (
              <p className="py-10 text-center text-ink-3">Sin chats</p>
            ) : (
              <ul aria-label="Chats" className="flex flex-col">
                {chatsConAlgo.map((c) => (
                  <li key={c.id} className="hog-entra flex items-center gap-1">
                    <button
                      type="button"
                      aria-current={c.id === guardado.actual || undefined}
                      onClick={() => elegirChat(c.id)}
                      className={cn(
                        "flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-control px-3 py-2 text-left active:bg-ink/8",
                        c.id === guardado.actual && "bg-sunken",
                      )}
                    >
                      <span className="w-full truncate text-[16px]">{c.titulo || "Chat"}</span>
                      <span className="text-[13px] text-ink-3">{cuando(c.actualizado)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Borrar «${c.titulo || "Chat"}»`}
                      onClick={() => borrarChat(c.id)}
                      className="flex h-12 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                    >
                      <Trash2 size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : vista === "ajustes" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-2">
            <section aria-labelledby="hog-abrir" className="flex flex-col gap-1.5">
              <h3 id="hog-abrir" className="px-1 text-[14px] font-semibold text-ink-2">
                Al tocar el botón
              </h3>
              <div role="radiogroup" aria-labelledby="hog-abrir" className="grid grid-cols-2 gap-1 rounded-control bg-sunken p-1">
                {(
                  [
                    ["ultimo", "Último chat"],
                    ["nuevo", "Chat nuevo"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={ajustes.abrir === v}
                    onClick={() => ponerAjustes({ ...ajustes, abrir: v })}
                    className={cn("flex h-11 items-center justify-center rounded-field text-[15px]", ajustes.abrir === v ? "bg-surface font-semibold" : "text-ink-2")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <button
              type="button"
              disabled={!chatsConAlgo.length}
              onClick={() => {
                setGuardado({ actual: null, chats: [] });
                setVista("chat");
              }}
              className="flex h-12 items-center rounded-control px-3 text-danger active:bg-ink/8 disabled:text-ink-3"
            >
              Borrar todos los chats
            </button>
          </div>
        ) : alto ? (
          <div aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pb-2">
            {turnos.map((t, i) => (
              <Burbuja key={`${chat?.id}-${i}`} turno={t} nueva={i === turnos.length - 1} onEnlace={abrirEnlace} />
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
            // La última respuesta, con su formato; si no cabe se desvanece abajo y tocarla la agranda.
            <div
              aria-live="polite"
              onClick={(e) => {
                if (!(e.target as Element).closest("a")) setGrande(true);
              }}
              className="hog-entra mx-3 mb-2 cursor-pointer rounded-panel bg-sunken px-3 py-2 text-[15px] leading-snug text-ink"
            >
              {ultima.hizo && <Hizo texto={ultima.hizo} />}
              <div ref={previa} className={cn("max-h-[7.5rem] min-w-0 overflow-hidden [overflow-wrap:anywhere]", desborda && "hog-corte")}>
                <RespuestaMarkdown texto={ultima.texto} onEnlace={abrirEnlace} />
              </div>
            </div>
          )
        )}

        {vista === "chat" && (
          <>
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
          </>
        )}
      </section>
    </>
  );
}

function BotonCabecera({
  etiqueta,
  onClick,
  disabled,
  activo,
  children,
}: {
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  activo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      aria-pressed={activo}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 w-10 shrink-0 items-center justify-center rounded-control text-ink-2 active:bg-ink/8 disabled:opacity-35",
        activo && "bg-sunken text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Hizo({ texto }: { texto: string }) {
  return (
    <span className="mb-1 flex items-center gap-1 text-[13px] font-medium text-hogariano">
      <IconoHogariano size={13} />
      {texto}
    </span>
  );
}

function Burbuja({ turno: t, nueva, onEnlace }: { turno: Turno; nueva: boolean; onEnlace: (url: string) => void }) {
  if (t.rol === "usuario")
    return (
      <div
        className={cn(
          "max-w-[85%] min-w-0 self-end whitespace-pre-wrap rounded-panel rounded-br-md bg-primary px-3 py-2 text-[16px] leading-snug text-primary-ink [overflow-wrap:anywhere]",
          nueva && "hog-entra",
        )}
      >
        {t.fotos ? <span className="block text-[13px] opacity-80">{t.fotos === 1 ? "1 foto" : `${t.fotos} fotos`}</span> : null}
        {t.texto}
      </div>
    );
  return (
    <div
      className={cn(
        "min-w-0 max-w-full self-start rounded-panel rounded-bl-md bg-sunken px-3 py-2 text-[16px] leading-snug text-ink [overflow-wrap:anywhere]",
        nueva && "hog-entra",
      )}
    >
      {t.hizo && <Hizo texto={t.hizo} />}
      <RespuestaMarkdown texto={t.texto} onEnlace={onEnlace} />
    </div>
  );
}

function Pensando() {
  return (
    <div role="status" className="hog-entra flex items-center self-start rounded-panel rounded-bl-md bg-sunken px-3 py-2">
      <IconoHogariano size={24} estado="pensando" />
      <span className="sr-only">Pensando</span>
    </div>
  );
}
