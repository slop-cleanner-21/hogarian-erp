"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile (CAPTCHA). Se carga solo cuando hace falta. Visible: la IP ya falló 3 veces (pide CAPTCHA
// para siempre); invisible: Supabase lo exige en todo ingreso, y solo aparece si Cloudflare necesita una
// interacción. El token va en el campo «cf-turnstile-response» del formulario (lo agrega Turnstile).

type Opciones = {
  sitekey: string;
  appearance: "always" | "interaction-only";
  size: "flexible";
  theme: "light" | "dark";
  language: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  "refresh-expired": "auto";
};
declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Opciones) => string; reset: (id: string) => void; remove: (id: string) => void };
  }
}

let carga: Promise<void> | null = null;
function cargar(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  carga ??= new Promise<void>((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      carga = null;
      mal(new Error("No se pudo cargar la verificación"));
    };
    document.head.appendChild(s);
  });
  return carga;
}

const tema = () =>
  document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";

/**
 * El widget. `onToken` recibe el token (o null si venció o falló). `reinicio` cambia tras cada envío: el token es de
 * un solo uso, así que se pide otro.
 */
export function Turnstile({ sitekey, visible, onToken, reinicio }: { sitekey: string; visible: boolean; onToken: (t: string | null) => void; reinicio: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const aviso = useRef(onToken);
  useEffect(() => {
    aviso.current = onToken;
  });

  useEffect(() => {
    let vivo = true;
    cargar()
      .then(() => {
        if (!vivo || !caja.current || !window.turnstile) return;
        id.current = window.turnstile.render(caja.current, {
          sitekey,
          appearance: visible ? "always" : "interaction-only",
          size: "flexible",
          theme: tema(),
          language: "es",
          callback: (t) => aviso.current(t),
          "expired-callback": () => aviso.current(null),
          "error-callback": () => aviso.current(null),
          "refresh-expired": "auto",
        });
      })
      .catch(() => aviso.current(null));
    return () => {
      vivo = false;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [sitekey, visible]);

  useEffect(() => {
    if (reinicio > 0 && id.current && window.turnstile) {
      aviso.current(null);
      window.turnstile.reset(id.current);
    }
  }, [reinicio]);

  return <div ref={caja} data-captcha={visible ? "visible" : "invisible"} className={visible ? "min-h-[65px]" : undefined} />;
}
