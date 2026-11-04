"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { guardar, leer } from "@/lib/recordar";
import { guardarVista } from "@/lib/vistas";

// Parámetros que no se recuerdan: el avance del scroll infinito.
const NO_RECORDAR = ["n"];

/**
 * Recuerda los filtros de una lista (parámetros de la URL) y los restaura al volver. Además los deja en
 * una cookie: así el servidor (proxy) ya abre la lista filtrada, sin pintarla primero sin filtros.
 * `base` son los parámetros que identifican la vista (p. ej. `tipo` OC/OS): no cuentan como filtro.
 * Cada vez que se entra a la vista (al montar o al cambiar la base) se restauran; dentro de la
 * misma vista, lo que el usuario cambie (incluso limpiar) se guarda.
 */
export function RecordarFiltros({
  clave,
  base = [],
  ignorar = [],
}: {
  clave: string;
  base?: string[];
  /** Parámetros de paso que no se recuerdan (p. ej. un filtro temporal que llega por link). */
  ignorar?: string[];
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const visita = useRef<string | null>(null);
  const actual = params.toString();
  const baseKey = base.join(",");
  const ignorarKey = ignorar.join(",");

  useEffect(() => {
    const k = `filtros:${clave}`;
    const base = baseKey ? baseKey.split(",") : [];
    const propios = new URLSearchParams(actual);
    const ignorados = ignorarKey ? ignorarKey.split(",") : [];
    // Si llegó con un parámetro de paso, esta visita no se guarda ni se restaura.
    if (ignorados.some((p) => propios.has(p))) return;
    for (const p of [...base, ...NO_RECORDAR]) propios.delete(p);

    // Al entrar a la vista sin filtros: se restauran los guardados.
    const original = new URLSearchParams(actual);
    const estaVisita = `${path}?${base.map((b) => `${b}=${original.get(b) ?? ""}`).join("&")}`;
    if (visita.current !== estaVisita) {
      visita.current = estaVisita;
      const guardado = leer<string>(k);
      if (propios.size === 0 && guardado) {
        const next = new URLSearchParams(guardado);
        for (const b of base) {
          const v = original.get(b);
          if (v) next.set(b, v);
        }
        router.replace(`${path}?${next}`, { scroll: false });
        return;
      }
    }
    guardar(k, propios.size ? propios.toString() : null);
    guardarVista(path, base, original, propios.size > 0);
  }, [actual, clave, baseKey, ignorarKey, path, router]);

  return null;
}
