"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { compartirEmpresaObra } from "@/lib/obra-compartida";

/** Pagos y Presupuesto (Tesorería): comparte la empresa y la obra que muestra la pantalla con la otra. */
export function CompartirEmpresaObra() {
  const path = usePathname();
  const actual = useSearchParams().toString();
  useEffect(() => compartirEmpresaObra(path, new URLSearchParams(actual)), [path, actual]);
  return null;
}
