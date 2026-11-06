import type { Rol } from "./types";

// Los avisos de prod 1 y a quién le tocan (migración prod1_preferencias_avisos). Cada uno elige en Avisos › «Elegir
// avisos»: los de su rol llegan por defecto (campana y celular); el Admin y Gerencia pueden sumarse a cualquiera, por
// defecto ninguno (y al sumarse, sin celular): así no se les llena el teléfono.

export type EventoAviso = { tipo: string; label: string; area: string; roles: Rol[] };

export const EVENTOS_AVISO: EventoAviso[] = [
  { tipo: "COTIZACION_RECIBIDA", label: "Un proveedor envió su cotización", area: "Logística", roles: ["LOGISTICA"] },
  { tipo: "RECHAZO", label: "Tesorería rechazó una orden", area: "Logística", roles: ["LOGISTICA"] },
  { tipo: "ADICIONAL", label: "Gerencia agregó un adicional", area: "Logística", roles: ["LOGISTICA"] },
  { tipo: "PRECIO_PRESUPUESTO", label: "Gerencia cambió un precio del presupuesto", area: "Logística", roles: ["LOGISTICA"] },
  { tipo: "POR_PAGAR", label: "Llegó una orden por pagar", area: "Tesorería", roles: ["TESORERIA"] },
  { tipo: "REENVIO", label: "Logística reenvió una orden corregida", area: "Tesorería", roles: ["TESORERIA"] },
  { tipo: "OS_PRECIO", label: "Una OS llegó con precios distintos al presupuesto", area: "Tesorería", roles: ["TESORERIA"] },
  { tipo: "PRESUPUESTO", label: "Gerencia publicó un presupuesto", area: "Operaciones", roles: ["JEFE_OPERACIONES", "OPERACIONES"] },
];

/** Quienes pueden sumarse a los avisos de los demás. */
const OPCIONALES: Rol[] = ["ADMIN", "GERENCIA"];

export type EventoDeRol = EventoAviso & { propio: boolean };

/** Los avisos que la persona puede elegir: los de sus roles (`propio`, llegan por defecto) y, el Admin y Gerencia, los demás. */
export function eventosDe(roles: Rol[]): EventoDeRol[] {
  const propio = (e: EventoAviso) => e.roles.some((r) => roles.includes(r));
  return EVENTOS_AVISO.filter((e) => propio(e) || roles.some((r) => OPCIONALES.includes(r))).map((e) => ({ ...e, propio: propio(e) }));
}

/** Lo que vale sin haber elegido nada. */
export const porDefecto = (propio: boolean) => ({ avisar: propio, celular: propio });
