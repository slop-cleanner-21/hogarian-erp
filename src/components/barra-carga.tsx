"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const EVENTO = "erp:carga";

/** Avisa que empezó una navegación hecha por código (router.push/replace), para mostrar la barra. */
export function iniciarCarga() {
  window.dispatchEvent(new Event(EVENTO));
}

/**
 * Señal inmediata de que la pantalla está cargando: una barra arriba y el contenido atenuado
 * (marca `data-cargando` en <html>). Cubre los cambios que no muestran el esqueleto de
 * loading.tsx, como pasar de OC a OS o cambiar la empresa: solo cambia la URL.
 * Se activa al tocar un enlace interno o con iniciarCarga(), y se apaga cuando cambia la URL.
 */
export function BarraCarga() {
  const path = usePathname();
  const busqueda = useSearchParams().toString();
  const [cargando, setCargando] = useState(false);
  const [url, setUrl] = useState(`${path}?${busqueda}`);
  if (url !== `${path}?${busqueda}`) {
    setUrl(`${path}?${busqueda}`);
    setCargando(false);
  }

  useEffect(() => {
    const encender = () => setCargando(true);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return;
      // Enlace a la pantalla en la que ya se está (p. ej. la pestaña activa del menú inferior): no navega.
      if (a.hasAttribute("data-aqui")) return;
      const destino = new URL(a.href, location.href);
      if (destino.origin !== location.origin || destino.pathname.startsWith("/sb/")) return;
      if (destino.pathname + destino.search === location.pathname + location.search) return;
      encender();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(EVENTO, encender);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(EVENTO, encender);
    };
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;
    if (!cargando) {
      delete raiz.dataset.cargando;
      return;
    }
    raiz.dataset.cargando = "";
    // Si la navegación no llega a cambiar la URL (error, misma página), no queda encendida.
    const t = setTimeout(() => setCargando(false), 12_000);
    return () => clearTimeout(t);
  }, [cargando]);

  return cargando ? <div role="progressbar" aria-label="Cargando" className="barra-carga" /> : null;
}
