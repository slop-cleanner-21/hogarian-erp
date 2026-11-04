// Los tres presupuestos de una obra (por rubro del ítem): Materiales se compra con OC; Mano de
// obra y Subcontratos (más locación, proyecto, finalización y otros servicios) con OS.

export const GRUPOS = [
  { value: "MATERIALES", label: "Materiales" },
  { value: "MANO_OBRA", label: "Mano de obra" },
  { value: "SUBCONTRATOS", label: "Subcontratos" },
] as const;

export type Grupo = (typeof GRUPOS)[number]["value"];

export const grupoDe = (v: unknown): Grupo => (v === "MANO_OBRA" || v === "SUBCONTRATOS" ? v : "MATERIALES");
