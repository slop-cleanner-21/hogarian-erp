"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Cerrar un <dialog> al tocar fuera (su fondo), solo si el toque empieza y termina fuera. Al apretar dentro (p. ej.
 * seleccionando texto de un campo) y soltar fuera, el clic cae en el <dialog> y lo cerraba.
 */
export function useCierreFuera(cerrar: () => void) {
  const empezoFuera = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      empezoFuera.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      const fuera = empezoFuera.current && e.target === e.currentTarget;
      empezoFuera.current = false;
      if (fuera) cerrar();
    },
  };
}
