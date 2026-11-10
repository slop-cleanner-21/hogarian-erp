// Retención por garantía de una OS: Logística la define al crearla, por tipo de partida. Se descuenta en la línea, antes de la de
// 4ta, y el proveedor factura el neto. Se devuelve en una OS de retenciones, con la obra cerrada.

export type CategoriaGarantia = "mano" | "sub" | "adic";
export type Garantia = Record<CategoriaGarantia, string>;

export const GARANTIA_DEFECTO: Garantia = { mano: "5", sub: "0", adic: "0" };

export const ETIQUETA_GARANTIA: Record<CategoriaGarantia, string> = { mano: "Mano de obra", sub: "Subcontratos", adic: "Adicionales" };

export const categoriaGarantia = (p: { requerimiento?: string | null; rubro?: string | null }): CategoriaGarantia =>
  p.requerimiento && p.requerimiento !== "REGULAR" ? "adic" : p.rubro === "MANO OBRA" ? "mano" : "sub";

export const pctValido = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100;
};

/** Lo retenido de un monto, como lo calcula la base. */
export const retenidoDe = (bruto: number, pct: number) => {
  const r = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return r(r(bruto) - r(bruto * (1 - pct / 100)));
};

/** «(5 %)»: lo retenido sobre el subtotal (así cuadra aunque la orden mezcle líneas con distinto % o sea del Excel). */
export const pctRetenido = (retenido: number, subtotal: number) => {
  if (!(subtotal > 0) || !(retenido > 0)) return "";
  const pct = Math.round((retenido / subtotal) * 1000) / 10;
  return `(${pct.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %)`;
};
