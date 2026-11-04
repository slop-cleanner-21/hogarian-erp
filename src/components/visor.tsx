"use client";

import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/format";

const STANDALONE = "(display-mode: standalone)";
const suscribirModo = (cb: () => void) => {
  const m = window.matchMedia(STANDALONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** true dentro de la app instalada (PWA): ahí no hay pestañas ni barra del navegador para volver. */
export function useEsPwa() {
  return useSyncExternalStore(
    suscribirModo,
    () => window.matchMedia(STANDALONE).matches || (navigator as { standalone?: boolean }).standalone === true,
    () => false,
  );
}

const ES_IMAGEN = /\.(jpe?g|png|webp|gif|heic)(\?|$)/i;

/**
 * Enlace a un archivo (PDF, guía, documento). Si es una imagen, se abre en el visor de la app.
 * Si no, en el navegador se abre en otra pestaña y en la PWA se descarga, porque abrirlo dejaría
 * al usuario en una pantalla sin forma de volver.
 */
export function EnlaceArchivo({
  href,
  nombre,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  href: string;
  nombre?: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const pwa = useEsPwa();
  const visor = useVisor();
  if (ES_IMAGEN.test(nombre ?? "") || ES_IMAGEN.test(href.split("?")[0])) {
    return (
      <>
        <button type="button" onClick={() => visor.abrir([{ url: href, alt: nombre }])} className={cn("text-left", className)} aria-label={ariaLabel}>
          {children}
        </button>
        {visor.elemento}
      </>
    );
  }
  return pwa ? (
    <a href={href} download={nombre ?? ""} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

/** Abre un archivo generado (blob): en la PWA lo descarga; en el navegador, en otra pestaña. */
export function abrirBlob(blob: Blob, nombre: string, pwa: boolean, ventana?: Window | null) {
  const url = URL.createObjectURL(blob);
  if (pwa) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (ventana) ventana.location.href = url;
  else window.open(url, "_blank");
}

/** `pie`: texto bajo la foto (p. ej. la cantidad y la fecha de la entrega). */
export type Foto = { url: string; alt?: string; pie?: string };

/**
 * Visor de fotos a pantalla completa dentro de la app: ✕ para cerrar, deslizar o flechas para
 * pasar. El botón atrás del teléfono lo cierra (sin salir de la app).
 */
export function useVisor() {
  const [estado, setEstado] = useState<{ fotos: Foto[]; inicio: number } | null>(null);
  return {
    abrir: (fotos: (string | Foto)[], inicio = 0) =>
      setEstado({ fotos: fotos.map((f) => (typeof f === "string" ? { url: f } : f)), inicio }),
    elemento: estado ? <Visor fotos={estado.fotos} inicio={estado.inicio} onClose={() => setEstado(null)} /> : null,
  };
}

function Visor({ fotos, inicio, onClose }: { fotos: Foto[]; inicio: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pista = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(inicio);
  const cerrar = useRef(onClose);
  useEffect(() => {
    cerrar.current = onClose;
  });

  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    pista.current?.scrollTo({ left: inicio * pista.current.clientWidth });
    // Una entrada en el historial: "atrás" cierra el visor en vez de salir de la pantalla.
    history.pushState(history.state, "");
    let porAtras = false;
    const onPop = () => {
      porAtras = true;
      cerrar.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!porAtras) history.back();
    };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ir = (i: number) => pista.current?.scrollTo({ left: i * pista.current.clientWidth, behavior: "smooth" });
  const foto = fotos[actual];

  return (
    <dialog
      ref={ref}
      onClose={() => cerrar.current()}
      aria-label="Fotos"
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => cerrar.current()}
            aria-label="Cerrar"
            className="flex h-12 w-12 items-center justify-center rounded-control active:bg-white/15"
          >
            <X size={24} />
          </button>
          <span className="num flex-1 text-center text-[15px]">{fotos.length > 1 ? `${actual + 1} / ${fotos.length}` : ""}</span>
          <a
            href={foto.url}
            download=""
            aria-label="Descargar foto"
            className="flex h-12 w-12 items-center justify-center rounded-control active:bg-white/15"
          >
            <Download size={22} />
          </a>
        </header>
        <div
          ref={pista}
          onScroll={(e) => setActual(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none]"
        >
          {fotos.map((f, i) => (
            <div key={f.url + i} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage */}
              <img src={f.url} alt={f.alt ?? "Foto"} className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
        {foto.pie && <p className="num shrink-0 px-4 pt-2 text-center text-[16px] font-semibold">{foto.pie}</p>}
        {fotos.length > 1 && (
          <div className="flex shrink-0 justify-between px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => ir(actual - 1)}
              disabled={actual === 0}
              aria-label="Foto anterior"
              className={cn("flex h-12 w-12 items-center justify-center rounded-control active:bg-white/15", actual === 0 && "opacity-30")}
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              onClick={() => ir(actual + 1)}
              disabled={actual === fotos.length - 1}
              aria-label="Foto siguiente"
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-control active:bg-white/15",
                actual === fotos.length - 1 && "opacity-30",
              )}
            >
              <ChevronRight size={26} />
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
