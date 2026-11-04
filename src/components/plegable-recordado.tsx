"use client";

import type { ReactNode } from "react";
import { Plegable } from "./plegable";

const MAX_EDAD = 60 * 60 * 24 * 365;

/** Guarda si se dejó abierto (cookie: el servidor lo pinta igual la próxima vez, sin saltar). */
function recordar(cookie: string, abierto: boolean) {
  document.cookie = `${cookie}=${abierto ? "1" : "0"}; path=/; max-age=${MAX_EDAD}; samesite=lax`;
}

/** Plegable que arranca como lo dejó el usuario la última vez (`abierto` viene de la cookie). */
export function PlegableRecordado({
  cookie,
  abierto,
  titulo,
  children,
}: {
  cookie: string;
  abierto: boolean;
  titulo: ReactNode;
  children: ReactNode;
}) {
  return (
    <Plegable titulo={titulo} abierto={abierto} onToggle={(a) => recordar(cookie, a)}>
      {children}
    </Plegable>
  );
}
