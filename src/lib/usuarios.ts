import type { Rol } from "./types";

/** Nombre de cada rol para mostrar. */
export const ROL_LABEL: Record<Rol, string> = {
  LOGISTICA: "Logística",
  TESORERIA: "Tesorería",
  GERENCIA: "Gerencia",
  JEFE_OPERACIONES: "Jefe de Operaciones",
  ADMIN: "Administrador",
  CONTABILIDAD: "Contabilidad",
  RESIDENTE: "Residente",
  OPERACIONES: "Ing. de Operaciones",
  OBRAS: "Obras",
  RRHH: "Recursos Humanos",
};

export const MIN_CONTRASENA = 8;

// Sin caracteres que se confunden al dictarla o copiarla a mano (0/O, 1/l/I).
const LETRAS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Contraseña temporal al azar (para una cuenta nueva o un restablecimiento). */
export function contrasenaAlAzar(largo = 10) {
  const r = new Uint32Array(largo);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => LETRAS[n % LETRAS.length]).join("");
}
