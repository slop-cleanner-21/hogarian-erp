// Filtro del presupuesto por estado de pago (Tesorería). Compartido entre el servidor y los filtros.

/** Cuánto de cada partida pagó Tesorería y cuánto tiene por pagar (órdenes en Tesorería). */
export type PagoPartida = { pagado: number; montoPagado: number; porPagar: number };

/** Estados de una orden que cuentan como pagada; EN_TESORERIA, por pagar. */
export const ESTADOS_PAGADA = new Set(["PAGADA", "EN_ENTREGA", "RECIBIDA"]);
export const ESTADOS_PAGO = ["PAGADA", "EN_ENTREGA", "RECIBIDA", "EN_TESORERIA"] as const;

/** Suma por partida las líneas de órdenes en Tesorería o pagadas (de `v_oc_items_calc`, estados `ESTADOS_PAGO`). */
export function acumularPagoPartida(
  filas: { partida_id: number | null; cantidad: number | null; parcial: number | null; estado: string | null; es_retencion: boolean | null }[],
): Map<number, PagoPartida> {
  const m = new Map<number, PagoPartida>();
  for (const f of filas) {
    if (f.partida_id == null) continue;
    const p = m.get(f.partida_id) ?? { pagado: 0, montoPagado: 0, porPagar: 0 };
    if (ESTADOS_PAGADA.has(f.estado ?? "")) {
      // La OS de retenciones devuelve dinero: su cantidad no es lo ejecutado.
      if (!f.es_retencion) p.pagado += Number(f.cantidad ?? 0);
      p.montoPagado += Number(f.parcial ?? 0);
    } else p.porPagar += Number(f.parcial ?? 0);
    m.set(f.partida_id, p);
  }
  return m;
}

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
