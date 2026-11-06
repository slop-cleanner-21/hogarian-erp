"use client";

import { useEffect } from "react";

// Diagnóstico en el navegador del usuario, para lo que no se puede reproducir aquí. Va a los logs del servidor (/diagnostico):
//   · los errores de JavaScript, de todos;
//   · en Android, qué pasa con las hojas (se abrió, qué se tocó, qué eventos llegaron, dónde estaba la hoja, si siguió abierta
//     después del toque, si la página se trabó), por una hoja que en un S25 no respondía a los toques.
// Si se ve «abre» y después nada, los toques no están llegando a la página. Nunca lo que se escribe: solo el tipo de evento y el
// nombre del botón. Se envía al juntar varios, tras 2 segundos sin actividad y al salir de la pantalla.
const MAX_ENVIOS = 30;
const POR_ENVIO = 15;

const hojaSuperior = () => {
  const hojas = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return { n: hojas.length, hoja: hojas[hojas.length - 1] ?? null };
};

export function Diagnostico() {
  useEffect(() => {
    let enviados = 0;
    let lote: string[] = [];
    let espera: number | undefined;
    const enviar = () => {
      window.clearTimeout(espera);
      if (!lote.length || enviados >= MAX_ENVIOS) return;
      enviados++;
      const v = window.visualViewport;
      const cuerpo = JSON.stringify({ ruta: location.pathname, ua: navigator.userAgent.slice(0, 120), ancho: innerWidth, alto: innerHeight, vv: `${Math.round(v?.height ?? 0)}+${Math.round(v?.offsetTop ?? 0)}`, eventos: lote });
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
    // Al salir de la pantalla o cambiar de app, lo pendiente se manda ya.
    const salir = () => document.visibilityState === "hidden" && enviar();
    window.addEventListener("pagehide", enviar);
    document.addEventListener("visibilitychange", salir);

    const android = /Android/.test(navigator.userAgent);
    const nombre = (el: Element | null | undefined) => el?.getAttribute("aria-label") ?? el?.getAttribute("role") ?? "";
    const toque = (e: Event) => {
      const { n, hoja } = hojaSuperior();
      if (!hoja) return;
      const t = e.target as HTMLElement | null;
      const boton = t?.closest?.("button");
      const p = e as PointerEvent;
      const r = hoja.getBoundingClientRect();
      anotar(`${e.type} ${t?.tagName ?? "?"} «${nombre(boton)}» hojas=${n} sup=«${nombre(hoja)}» ${p.pointerType ?? ""} y=${Math.round(p.clientY ?? 0)} hoja=${Math.round(r.top)}+${Math.round(r.height)}`);
      if (e.type === "click" && boton) {
        const etiqueta = nombre(boton);
        // El veredicto: ¿el toque cerró la hoja?
        window.setTimeout(() => {
          if (hoja.isConnected && hoja.open) anotar(`sigue-abierta «${nombre(hoja)}» tras click en «${etiqueta}»`);
          enviar();
        }, 700);
      }
    };
    const tipos = ["pointerdown", "pointerup", "pointercancel", "click"];
    let aperturas: MutationObserver | undefined;
    let trabas: PerformanceObserver | undefined;
    if (android) {
      tipos.forEach((t) => document.addEventListener(t, toque, true));
      aperturas = new MutationObserver((cambios) => {
        for (const c of cambios) {
          const d = c.target as HTMLDialogElement;
          if (d.tagName === "DIALOG" && d.open) anotar(`abre «${nombre(d)}» foco=${document.activeElement?.tagName}`);
        }
      });
      aperturas.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
      try {
        trabas = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (e.duration > 300 && hojaSuperior().hoja) anotar(`traba ${Math.round(e.duration)}ms`);
        });
        trabas.observe({ type: "longtask" });
      } catch {}
    }

    return () => {
      enviar();
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rechazo);
      window.removeEventListener("pagehide", enviar);
      document.removeEventListener("visibilitychange", salir);
      if (android) tipos.forEach((t) => document.removeEventListener(t, toque, true));
      aperturas?.disconnect();
      trabas?.disconnect();
    };
  }, []);
  return null;
}
