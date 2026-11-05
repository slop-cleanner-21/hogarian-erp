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

/** Contraseña temporal al azar (para una cuenta nueva o un restablecimiento), siempre con letras y números. */
export function contrasenaAlAzar(largo = 10) {
  for (;;) {
    const r = new Uint32Array(largo);
    crypto.getRandomValues(r);
    const clave = Array.from(r, (n) => LETRAS[n % LETRAS.length]).join("");
    if (contrasenaValida(clave) === null) return clave;
  }
}

/** Lo que se exige a una contraseña (también en Supabase Auth: password_requirements = "letters_digits"). */
export function contrasenaValida(clave: string): string | null {
  if (clave.length < MIN_CONTRASENA) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres`;
  if (clave.length > 72) return "La contraseña es demasiado larga";
  if (!/[a-zA-Z]/.test(clave) || !/[0-9]/.test(clave)) return "La contraseña debe tener letras y números";
  return null;
}
