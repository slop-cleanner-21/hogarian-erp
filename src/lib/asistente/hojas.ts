import { useEffect, useRef } from "react";

// Hogariano abre hojas de la app (el menú del usuario, el diseño de la lista, los filtros, el formulario de sugerencia) con
// un evento del navegador: cada hoja lo escucha mientras está en pantalla, sin que el panel tenga que conocerla. Puede llevar
// datos (la sugerencia, ya escrita y con sus capturas).
export const ABRIR_HOJA = "prod1:abrir-hoja";
type Detalle = { que: string; datos?: unknown };

export const abrirHoja = (que: string, datos?: unknown) => window.dispatchEvent(new CustomEvent<Detalle>(ABRIR_HOJA, { detail: { que, datos } }));

/** La hoja `que` se abre cuando Hogariano la pide (con sus datos, si los trae). */
export function useAbrirHoja(que: string, abrir: (datos?: unknown) => void) {
  const fn = useRef(abrir);
  useEffect(() => {
    fn.current = abrir;
  });
  useEffect(() => {
    const oir = (e: Event) => {
      const d = (e as CustomEvent<Detalle>).detail;
      if (d?.que === que) fn.current(d.datos);
    };
    window.addEventListener(ABRIR_HOJA, oir);
    return () => window.removeEventListener(ABRIR_HOJA, oir);
  }, [que]);
}
