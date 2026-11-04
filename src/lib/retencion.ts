// Retención del impuesto a la renta de 4ta categoría (Ley del Impuesto a la Renta, art. 71): Hogarian la
// retiene de los recibos por honorarios de más de S/ 1,500, por el % del proveedor (8 % por ley). No se
// retiene si el proveedor tiene suspensión de retenciones vigente (Formulario 1609): vale desde que SUNAT
// la otorga hasta el 31 de diciembre de ese mismo año.

export const RETENCION_4TA_MINIMO = 1500;
export const RETENCION_4TA_PCT = 8;

/** ¿La suspensión otorgada el `otorgada` (AAAA-MM-DD) cubre un recibo emitido el `fecha`? */
export function suspensionVigente(otorgada: string | null | undefined, fecha: string) {
  return !!otorgada && fecha >= otorgada && fecha.slice(0, 4) === otorgada.slice(0, 4);
}

/** Retención sugerida de un recibo por honorarios. */
export function retencion4ta(total: number, fecha: string, proveedor: { pct: number | null; suspension: string | null }) {
  if (!(total > RETENCION_4TA_MINIMO) || suspensionVigente(proveedor.suspension, fecha)) return 0;
  return +((total * (proveedor.pct ?? RETENCION_4TA_PCT)) / 100).toFixed(2);
}
