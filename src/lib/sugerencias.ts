export type TipoSugerencia = "ERROR" | "MEJORA" | "DISENO";

export const TIPOS_SUGERENCIA: { valor: TipoSugerencia; corto: string; label: string }[] = [
  { valor: "ERROR", corto: "Error", label: "Error en la app" },
  { valor: "MEJORA", corto: "Mejora", label: "Mejora" },
  { valor: "DISENO", corto: "Diseño", label: "Preferencia de diseño" },
];
