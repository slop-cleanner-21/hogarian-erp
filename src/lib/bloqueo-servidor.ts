// Bloqueo con huella hecho cumplir en el servidor (no solo en el navegador: desactivar JavaScript o ver el código
// de la página no se lo salta). Lo usan el proxy y las acciones de ingreso y huella.
//
// - prod1_huella_disp: este dispositivo tiene la huella activada para ese usuario (al activarla o entrar con ella).
// - prod1_desbloqueo: «desbloqueado hasta»; se renueva con cada pedido y vence a los VENTANA_MS sin actividad (la
//   app manda un latido cada minuto mientras está a la vista). Vencido, el proxy no entrega pantallas: redirige a
//   /desbloquear (y a un pedido que no es una pantalla le responde 401).
// - prod1_sin_bloqueo: la base dijo hace poco que esta sesión no tiene bloqueo (para no preguntarle en cada pedido).
// Van firmadas (HMAC con un secreto del servidor) y son httpOnly: el navegador no las puede leer ni fabricar.
//
// Las cookies son solo para responder rápido: lo que manda es la base (sesiones_bloqueo, migración prod1_seguridad_3).
// Una sesión con bloqueo vencido no lee ni escribe nada, aunque se borren las cookies o se use el token directo contra
// la API; el proxy le pregunta a la base cuando no tiene una cookie reciente que lo resuelva.

export const COOKIE_DISPOSITIVO = "prod1_huella_disp";
export const COOKIE_DESBLOQUEO = "prod1_desbloqueo";
export const COOKIE_LIBRE = "prod1_sin_bloqueo";
export const VENTANA_MS = 3 * 60_000;
/** Con un «desbloqueado» renovado hace menos que esto, el proxy no le pregunta a la base. */
export const RENOVAR_MS = 45_000;
/** Cuánto vale la marca «sin bloqueo» de una sesión. */
const LIBRE_MS = 10 * 60_000;
const UN_ANIO = 60 * 60 * 24 * 365;

export const opcionesCookie = (maxAge?: number) =>
  ({ httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", ...(maxAge ? { maxAge } : {}) });
export const opcionesDispositivo = () => opcionesCookie(UN_ANIO);
// La de desbloqueo vive lo mismo que su ventana (firmada además con su vencimiento).
export const opcionesDesbloqueo = () => opcionesCookie(Math.ceil(VENTANA_MS / 1000));
export const opcionesLibre = () => opcionesCookie(LIBRE_MS / 1000);

const enc = new TextEncoder();
let clave: Promise<CryptoKey> | null = null;
function claveHmac() {
  clave ??= crypto.subtle
    .digest("SHA-256", enc.encode(`hogarian-bloqueo:${process.env.BLOQUEO_SECRETO ?? process.env.SUPABASE_SECRET_KEY ?? ""}`))
    .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  return clave;
}
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function firmar(valor: string) {
  return `${valor}.${b64(await crypto.subtle.sign("HMAC", await claveHmac(), enc.encode(valor)))}`;
}

/** El valor firmado, si la firma es válida. */
export async function leerFirmado(cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const i = cookie.lastIndexOf(".");
  if (i <= 0) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await claveHmac(), deB64(cookie.slice(i + 1)), enc.encode(cookie.slice(0, i)));
    return ok ? cookie.slice(0, i) : null;
  } catch {
    return null;
  }
}

/** Valor de la cookie de desbloqueo de un usuario, vigente por una ventana desde ahora. */
export const desbloqueoPara = (userId: string) => firmar(`${userId}:${Date.now() + VENTANA_MS}`);

/** Hasta cuándo vale la cookie de desbloqueo para ese usuario (null: no vale o venció). */
export async function desbloqueoHasta(cookie: string | undefined, userId: string): Promise<number | null> {
  const v = await leerFirmado(cookie);
  if (!v) return null;
  const [u, hasta] = v.split(":");
  return u === userId && Number(hasta) > Date.now() ? Number(hasta) : null;
}

/** Si la cookie de desbloqueo vale para ese usuario y no venció. */
export const desbloqueoVigente = async (cookie: string | undefined, userId: string) => (await desbloqueoHasta(cookie, userId)) !== null;

/** Marca «sin bloqueo» de una sesión (session_id del JWT). */
export const librePara = (sesionId: string) => firmar(`libre:${sesionId}:${Date.now() + LIBRE_MS}`);

export async function libreVigente(cookie: string | undefined, sesionId: string) {
  const v = await leerFirmado(cookie);
  if (!v) return false;
  const [marca, sid, hasta] = v.split(":");
  return marca === "libre" && sid === sesionId && Number(hasta) > Date.now();
}
