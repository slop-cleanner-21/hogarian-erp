"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { guardar, leer } from "@/lib/recordar";
import { COOKIE_ULTIMA } from "@/lib/ultima-ruta";

const CLAVE = "ultima-ruta";

// Pantallas que no se retoman: entrada, acceso y el link público del proveedor.
const NO_RECORDAR = ["/login", "/acceso", "/cotizar", "/voucher-simulado", "/comprobante-simulado"];

/** Pantalla anterior dentro de la app (para que «Volver» use el historial cuando lleva a ella). */
export const CLAVE_ANTERIOR = "erp:pantalla-anterior";

/** Guarda la pantalla actual (ruta + filtros/pestañas de la URL) para retomarla al volver a abrir la app. */
export function RecordarRuta() {
  const path = usePathname();
  const busqueda = useSearchParams().toString();
  const actual = useRef<string | null>(null);
  useEffect(() => {
    // Antes de pasar a la nueva, la que se deja es la «anterior».
    const nueva = busqueda ? `${path}?${busqueda}` : path;
    try {
      if (actual.current && actual.current.split("?")[0] !== path) sessionStorage.setItem(CLAVE_ANTERIOR, actual.current);
    } catch {
      // sin sessionStorage: «Volver» navega a su destino
    }
    actual.current = nueva;
  }, [path, busqueda]);
  useEffect(() => {
    if (path === "/" || NO_RECORDAR.some((p) => path.startsWith(p))) return;
    const ruta = busqueda ? `${path}?${busqueda}` : path;
    guardar(CLAVE, ruta);
    document.cookie = `${COOKIE_ULTIMA}=${encodeURIComponent(ruta)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [path, busqueda]);
  return null;
}

/**
 * Al abrir la app en "/": vuelve a la última pantalla si pertenece al módulo del usuario;
 * si no, a su inicio.
 */
export function RetomarRuta({ inicio, prefijos }: { inicio: string; prefijos: string[] | null }) {
  const router = useRouter();
  useEffect(() => {
    const ultima = leer<string>(CLAVE);
    const valida = ultima && (prefijos == null || prefijos.some((p) => ultima === p || ultima.startsWith(`${p}/`) || ultima.startsWith(`${p}?`)));
    router.replace(valida ? ultima : inicio);
  }, [router, inicio, prefijos]);
  return null;
}
