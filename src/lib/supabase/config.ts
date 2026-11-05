// Acceso a Supabase.
// - Local (y demo por túnel): el navegador no llama a Supabase directo, pasa por la propia app en /sb
//   (rewrite en next.config.ts). Funciona igual en localhost, en la red local o por un túnel público,
//   sin exponer el puerto de Supabase.
// - Producción (Supabase en la nube): NEXT_PUBLIC_SUPABASE_DIRECTO=1 y el navegador habla directo con
//   NEXT_PUBLIC_SUPABASE_URL; /sb no existe (ver docs/seguridad-cotizacion.md, R8).

/** El navegador habla directo con Supabase (producción). */
export const SUPABASE_DIRECTO = process.env.NEXT_PUBLIC_SUPABASE_DIRECTO === "1";

/** Ruta pública por la que la app reenvía a Supabase (solo sin conexión directa). */
export const RUTA_SUPABASE = "/sb";

/**
 * La cookie de sesión: nombre fijo (navegador y servidor usan URLs distintas), solo por HTTPS en producción y sin
 * viajar en pedidos de otros sitios. No puede ser httpOnly: el navegador la lee para hablar con Supabase (lo que la
 * protege si alguien llega a leerla en un dispositivo bloqueado: la base no le da nada a esa sesión).
 */
export const COOKIE_SESION = { name: "sb-prod1-auth-token", sameSite: "lax", ...(SUPABASE_DIRECTO ? { secure: true } : {}) } as const;

/** URL de Supabase para el servidor (interna). */
export const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;

/** Convierte una URL de Supabase (p. ej. firmada de storage) en ruta pública de la app (con conexión directa, la misma). */
export const urlPublica = (url: string) =>
  !SUPABASE_DIRECTO && url.startsWith(URL_SUPABASE) ? RUTA_SUPABASE + url.slice(URL_SUPABASE.length) : url;

/** URL de Supabase para el navegador. */
export const urlNavegador = () => (SUPABASE_DIRECTO ? URL_SUPABASE : `${window.location.origin}${RUTA_SUPABASE}`);
