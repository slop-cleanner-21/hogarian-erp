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

/**
 * Celular para WhatsApp: solo dígitos, con el código del país. Un número peruano de 9 dígitos (empieza con 9) lleva
 * el 51 adelante. "" si no hay; null si no es válido.
 */
export function normalizarCelular(texto: string): string | null {
  const d = texto.replace(/\D/g, "");
  if (d === "") return "";
  if (/^9\d{8}$/.test(d)) return `51${d}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

/** +51 987 654 321 (o el número tal cual si no es de Perú). */
export function celularLegible(tel: string) {
  const m = /^51(\d{3})(\d{3})(\d{3})$/.exec(tel);
  return m ? `+51 ${m[1]} ${m[2]} ${m[3]}` : `+${tel}`;
}

/** Abre WhatsApp con el mensaje ya escrito, para ese número (el Admin lo envía). */
export const enlaceWhatsapp = (tel: string, texto: string) => `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;

const primerNombre = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? "";

export function mensajeLink(nombre: string, url: string, vence: string) {
  const hasta = new Date(vence).toLocaleDateString("es-PE", { day: "numeric", month: "long", timeZone: "America/Lima" });
  return `Hola ${primerNombre(nombre)}: este es tu acceso al ERP de Hogarian. Entra aquí para completar tus datos y crear tu contraseña (sirve una sola vez, hasta el ${hasta}):\n${url}`;
}

export function mensajeContrasena(nombre: string, app: string, email: string, contrasena: string) {
  return `Hola ${primerNombre(nombre)}: tu acceso al ERP de Hogarian.\n${app}\nCorreo: ${email}\nContraseña temporal: ${contrasena}\nCámbiala al entrar, en tu menú › Cambiar contraseña.`;
}
