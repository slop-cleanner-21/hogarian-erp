// Contraseña de acceso a la demo (DEMO_ACCESO en .env.local). Si está definida, toda la app
// (salvo /acceso y los links de cotización para proveedores) exige haberla ingresado antes.

export const COOKIE_ACCESO = "prod1-acceso";
export const RUTA_ACCESO = "/acceso";

export const accesoActivo = () => !!process.env.DEMO_ACCESO;

/** Valor de la cookie: hash de la contraseña (no se guarda la contraseña en claro). */
export async function firmaAcceso(clave = process.env.DEMO_ACCESO ?? "") {
  const datos = new TextEncoder().encode(`hogarian-erp:${clave}`);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
