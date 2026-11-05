import type { Rol } from "./types";

export const HOME_BY_ROL: Record<Rol, string> = {
  LOGISTICA: "/logistica",
  // Roles sin módulo en prod 1: van a «Sin acceso».
  CONTABILIDAD: "/sin-acceso",
  TESORERIA: "/tesoreria",
  ADMIN: "/logistica",
  RESIDENTE: "/sin-acceso",
  GERENCIA: "/gerencia/obras",
  // Prod 1: lo mismo que el Jefe (el seguimiento).
  OPERACIONES: "/operaciones",
  JEFE_OPERACIONES: "/operaciones",
  // Rol en desuso (lo reemplazó Operaciones): sin módulo propio.
  OBRAS: "/sin-acceso",
  RRHH: "/sin-acceso",
};
