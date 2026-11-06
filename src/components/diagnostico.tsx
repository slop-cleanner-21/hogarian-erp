"use client";

import { useEffect } from "react";

// Diagnóstico en el navegador del usuario, para lo que no se puede reproducir aquí. Va a los logs del servidor (/diagnostico):
//   · los errores de JavaScript, de todos;
//   · en Samsung Internet, qué pasa con cada toque mientras hay una hoja abierta (qué se tocó y qué eventos llegaron), por una
//     hoja que en ese navegador no respondía. Nunca lo que se escribe: solo el tipo de evento y el nombre del botón.
const MAX_ENVIOS = 12;

export function Diagnostico() {
  useEffect(() => {
    let enviados = 0;
    let lote: string[] = [];
    let espera: number | undefined;
    const enviar = () => {
      if (!lote.length || enviados >= MAX_ENVIOS) return;
      enviados++;
      const cuerpo = JSON.stringify({ ruta: location.pathname, ua: navigator.userAgent.slice(0, 120), ancho: innerWidth, alto: innerHeight, vv: Math.round(visualViewport?.height ?? 0), eventos: lote });
      lote = [];
      navigator.sendBeacon?.("/diagnostico", cuerpo.slice(0, 3000));
    };
    const anotar = (texto: string) => {
      if (lote.length < 40) lote.push(texto.slice(0, 120));
      window.clearTimeout(espera);
      espera = window.setTimeout(enviar, 2500);
    };

    const error = (e: ErrorEvent) => anotar(`error ${e.message} ${e.filename?.split("/").pop() ?? ""}:${e.lineno}`);
    const rechazo = (e: PromiseRejectionEvent) => anotar(`rechazo ${String(e.reason?.message ?? e.reason)}`);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rechazo);

    const samsung = /SamsungBrowser/.test(navigator.userAgent);
    const toque = (e: Event) => {
      const hojas = document.querySelectorAll("dialog[open]");
      if (!hojas.length) return;
      const t = e.target as HTMLElement | null;
      const boton = t?.closest?.("button");
      const superior = hojas[hojas.length - 1] as HTMLElement;
      anotar(`${e.type} ${t?.tagName ?? "?"} ${boton?.getAttribute("aria-label") ?? boton?.getAttribute("role") ?? ""} hojas=${hojas.length} sup=${superior.getAttribute("aria-label") ?? ""} ${(e as PointerEvent).pointerType ?? ""}`);
    };
    const tipos = ["pointerdown", "pointerup", "pointercancel", "click"];
    if (samsung) tipos.forEach((t) => document.addEventListener(t, toque, true));

    return () => {
      window.clearTimeout(espera);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rechazo);
      if (samsung) tipos.forEach((t) => document.removeEventListener(t, toque, true));
    };
  }, []);
  return null;
}
