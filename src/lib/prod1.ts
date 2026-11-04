import type { Rol } from "./types";

/**
 * Prod 1: solo entran Logística, Tesorería, Gerencia y el Jefe de Operaciones (y Admin). Los demás
 * roles siguen en la base para migrar después al sistema completo, pero no tienen módulo aquí.
 */
export const ROLES_PROD1: readonly Rol[] = ["LOGISTICA", "TESORERIA", "GERENCIA", "JEFE_OPERACIONES", "ADMIN"];

export const rolEnProd1 = (rol: Rol) => ROLES_PROD1.includes(rol);

/** Pantallas que no existen en prod 1 (los avisos viejos que apuntan ahí quedan sin enlace). */
const QUITADAS = [
  "/contabilidad",
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
