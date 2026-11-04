"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { guardar, leer } from "@/lib/recordar";

const CLAVE = "tesoreria-seleccion";

/** Recuerda la empresa y el área elegidas en Tesorería. */
export function GuardarSeleccion({ empresa, area }: { empresa: string; area: string }) {
  useEffect(() => guardar(CLAVE, { empresa, area }), [empresa, area]);
  return null;
}

/** Al entrar a Tesorería sin elegir nada, vuelve a la última empresa y área. */
export function RetomarSeleccion() {
  const router = useRouter();
  useEffect(() => {
    const s = leer<{ empresa: string; area: string }>(CLAVE);
    if (s?.empresa && s.area) router.replace(`/tesoreria?empresa=${s.empresa}&area=${s.area}`);
  }, [router]);
  return null;
}
