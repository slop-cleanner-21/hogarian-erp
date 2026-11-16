import { useEffect, useRef } from "react";

// Hogariano abre hojas de la app (el menú del usuario, el diseño de la lista, los filtros, el formulario de sugerencia) con
// un evento del navegador: cada hoja lo escucha mientras está en pantalla, sin que el panel tenga que conocerla.
export const ABRIR_HOJA = "prod1:abrir-hoja";

export const abrirHoja = (que: string) => window.dispatchEvent(new CustomEvent(ABRIR_HOJA, { detail: que }));

/** La hoja `que` se abre cuando Hogariano la pide. */
export function useAbrirHoja(que: string, abrir: () => void) {
  const fn = useRef(abrir);
  useEffect(() => {
    fn.current = abrir;
  });
  useEffect(() => {
    const oir = (e: Event) => {
      if ((e as CustomEvent<string>).detail === que) fn.current();
    };
    window.addEventListener(ABRIR_HOJA, oir);
    return () => window.removeEventListener(ABRIR_HOJA, oir);
  }, [que]);
}
