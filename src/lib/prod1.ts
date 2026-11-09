import type { Rol } from "./types";

/**
 * Prod 1: solo entran Logística, Tesorería, Gerencia, Contabilidad (Jefe y Asistente), el Jefe y el Ingeniero de
 * Operaciones (y Admin). El Ingeniero tiene exactamente lo mismo que el Jefe: solo ver el seguimiento (la base lo trata
 * como Jefe); el Asistente de Contabilidad, lo mismo que el Jefe de Contabilidad. Los demás roles siguen en la base para
 * migrar después al sistema completo, pero no tienen módulo aquí.
 */
export const ROLES_PROD1: readonly Rol[] = [
  "LOGISTICA",
  "TESORERIA",
  "GERENCIA",
  "CONTABILIDAD",
  "ASISTENTE_CONTABILIDAD",
  "JEFE_OPERACIONES",
  "OPERACIONES",
  "ADMIN",
];

/** Contabilidad: el Jefe y el Asistente (lo mismo). */
export const ROLES_CONTABILIDAD: Rol[] = ["CONTABILIDAD", "ASISTENTE_CONTABILIDAD"];

/** Los que solo ven el seguimiento de compras (Jefe e Ingeniero de Operaciones). */
export const ROLES_SEGUIMIENTO: Rol[] = ["JEFE_OPERACIONES", "OPERACIONES"];

export const rolEnProd1 = (rol: Rol) => ROLES_PROD1.includes(rol);

/** Pantallas que no existen en prod 1 (los avisos viejos que apuntan ahí quedan sin enlace). */
const QUITADAS = [
  "/residente",
  "/rrhh",
  "/logistica/requerimientos",
  "/gerencia/solicitudes",
  "/operaciones/requerimientos",
  "/operaciones/solicitudes",
  "/operaciones/valorizaciones",
  "/operaciones/obra",
];

export const rutaEnProd1 = (href: string) => !QUITADAS.some((r) => href === r || href.startsWith(`${r}/`) || href.startsWith(`${r}?`));
