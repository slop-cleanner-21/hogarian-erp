import { money } from "./format";

export type Tono = "sobre" | "alto" | "bajo" | "igual";

/** Clases por tono: rojo sobre el máximo, ámbar sobre presupuesto, verde bajo presupuesto. */
export const CLASE_TONO: Record<Tono, string> = {
  sobre: "bg-danger-bg text-danger font-semibold",
  alto: "bg-warn-bg text-warn font-semibold",
  bajo: "bg-ok-bg text-ok font-semibold",
  igual: "text-ink-2",
};

/** Clasifica un precio frente a la referencia (presupuesto) y su máximo permitido. */
export function tonoPrecio(pu: number, referencia: number, maximo?: number | null): Tono {
  if (maximo != null && pu > maximo + 0.0001) return "sobre";
  if (pu > referencia + 0.0001) return "alto";
  if (pu < referencia - 0.0001) return "bajo";
  return "igual";
}

/** "+S/ 0.80 (+2.6 %)" */
export function textoDiferencia(pu: number, referencia: number) {
  const dif = pu - referencia;
  const pct = referencia ? (dif / referencia) * 100 : 0;
  const signo = dif > 0 ? "+" : "";
  return `${dif < 0 ? "-" : signo}S/ ${money(Math.abs(dif))} (${signo}${pct.toFixed(1)} %)`;
}
