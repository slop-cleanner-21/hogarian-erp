"use client";

import { useEffect } from "react";

// Los errores de JavaScript en el navegador del usuario van a los logs del servidor (/diagnostico): lo que no se puede reproducir
// aquí. Nunca lo que se escribe: solo el mensaje del error y dónde ocurrió. Se envía tras 2 segundos sin más errores y al salir.
const MAX_ENVIOS = 30;
const POR_ENVIO = 15;

export function Diagnostico() {
  useEffect(() => {
    let enviados = 0;
    let lote: string[] = [];
    let espera: number | undefined;
    const enviar = () => {
      window.clearTimeout(espera);
      if (!lote.length || enviados >= MAX_ENVIOS) return;
      enviados++;
      const cuerpo = JSON.stringify({ ruta: location.pathname, ua: navigator.userAgent.slice(0, 120), ancho: innerWidth, eventos: lote });
      lote = [];
      navigator.sendBeacon?.("/diagnostico", cuerpo.slice(0, 6000));
    };
    const anotar = (texto: string) => {
      lote.push(`${Math.round(performance.now())} ${texto.slice(0, 160)}`);
      if (lote.length >= POR_ENVIO) return enviar();
      window.clearTimeout(espera);
      espera = window.setTimeout(enviar, 2000);
    };

    const error = (e: ErrorEvent) => anotar(`error ${e.message} ${e.filename?.split("/").pop() ?? ""}:${e.lineno}`);
    const rechazo = (e: PromiseRejectionEvent) => anotar(`rechazo ${String(e.reason?.message ?? e.reason)}`);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rechazo);
    const salir = () => document.visibilityState === "hidden" && enviar();
    window.addEventListener("pagehide", enviar);
    document.addEventListener("visibilitychange", salir);
    return () => {
      enviar();
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rechazo);
      window.removeEventListener("pagehide", enviar);
      document.removeEventListener("visibilitychange", salir);
    };
  }, []);
  return null;
}
