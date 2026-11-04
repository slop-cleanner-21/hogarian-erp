// Filtro del presupuesto por estado de pago (Tesorería). Compartido entre el servidor y los filtros.

/** Cuánto de cada partida pagó Tesorería y cuánto tiene por pagar (órdenes en Tesorería). */
export type PagoPartida = { pagado: number; montoPagado: number; porPagar: number };

/** Estados de pago para filtrar el presupuesto. */
export const FILTROS_PAGO = [
  { value: "porpagar", label: "Por pagar" },
  { value: "parcial", label: "Pagado parcial" },
  { value: "completo", label: "Pagado completo" },
  { value: "sinpagar", label: "Sin pagar" },
] as const;
export type FiltroPago = (typeof FILTROS_PAGO)[number]["value"];

/** ¿La partida cumple el filtro de pago? `presupuestado` en cantidad. */
export function cumplePago(filtro: FiltroPago, presupuestado: number, p: PagoPartida | undefined): boolean {
  const pagado = p?.pagado ?? 0;
  switch (filtro) {
    case "porpagar":
      return (p?.porPagar ?? 0) > 0.005;
    case "completo":
      return presupuestado > 0 && pagado >= presupuestado - 0.0001;
    case "parcial":
      return pagado > 0.0001 && pagado < presupuestado - 0.0001;
    case "sinpagar":
      return pagado <= 0.0001;
  }
}
