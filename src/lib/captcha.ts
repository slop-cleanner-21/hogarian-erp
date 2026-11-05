import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// CAPTCHA del ingreso (Cloudflare Turnstile) y reintentos por IP.
//
// - Desde el 3.er intento fallido desde una IP, esa IP pide CAPTCHA para siempre (login_ips); y desde el 3.º de una
//   IP con una misma cuenta, cada nuevo fallo reciente hace esperar más (5 s, 10 s, 20 s… hasta 5 min).
// - Con CAPTCHA_EN_SUPABASE=1 (producción), Supabase Auth exige el token en todo ingreso con contraseña: así nadie
//   prueba contraseñas directo contra Supabase. La página lo pide siempre (invisible si la IP no está marcada) y
//   Supabase lo verifica (el token es de un solo uso: la app no lo verifica antes).
// - Sin eso (local), la app lo pide solo a las IP marcadas y lo verifica ella.
// - Sin claves de Turnstile, no hay CAPTCHA: quedan los reintentos con espera y los límites por cuenta e IP.
// Claves de prueba de Cloudflare (siempre aprueban): sitio 1x00000000000000000000AA, secreta
// 1x0000000000000000000000000000000AA.

export const captchaSitio = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
export const captchaEnSupabase = () => process.env.CAPTCHA_EN_SUPABASE === "1";
const secreta = () => process.env.TURNSTILE_SECRET_KEY || null;
export const captchaDisponible = () => !!captchaSitio() && (captchaEnSupabase() || !!secreta());

/** En local todo llega de la misma máquina: ahí no se marca la IP (las pruebas simulan otra con X-Forwarded-For). */
export const ipLocal = (ip: string | null) => !ip || ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip);

export type EstadoIp = { captcha: boolean; fallos: number; ultimoFallo: number | null };

export async function estadoIp(ip: string | null): Promise<EstadoIp> {
  if (ipLocal(ip)) return { captcha: false, fallos: 0, ultimoFallo: null };
  const { data } = await createAdminClient().from("login_ips").select("fallos, captcha_desde, ultimo_fallo_at").eq("ip", ip!).maybeSingle();
  return {
    captcha: !!data?.captcha_desde,
    fallos: data?.fallos ?? 0,
    ultimoFallo: data?.ultimo_fallo_at ? Date.parse(data.ultimo_fallo_at) : null,
  };
}

/** Un intento fallido desde la IP. Devuelve si ahora pide CAPTCHA y si se acaba de marcar. */
export async function falloIp(ip: string | null): Promise<{ captcha: boolean; nuevo: boolean }> {
  if (ipLocal(ip)) return { captcha: false, nuevo: false };
  const { data } = await createAdminClient().rpc("login_fallo_ip", { p_ip: ip! });
  const r = data?.[0];
  return { captcha: !!r?.captcha, nuevo: !!r?.nuevo_captcha };
}

/** Segundos que hay que esperar tras el último fallo de una IP con una cuenta, según sus fallos recientes (15 min):
 *  desde el 3.º, 5 s, 10 s, 20 s… hasta 5 min. */
export function espera(recientes: number, ultimoFallo: number | null): number {
  if (recientes < 3 || !ultimoFallo) return 0;
  const segundos = Math.min(5 * 2 ** (recientes - 3), 300);
  return Math.max(0, Math.ceil((ultimoFallo + segundos * 1000 - Date.now()) / 1000));
}

/** Verifica un token de Turnstile (solo cuando lo verifica la app, no Supabase). */
export async function verificarCaptcha(token: string, ip: string | null): Promise<boolean> {
  const clave = secreta();
  if (!clave || !token) return false;
  const cuerpo = new URLSearchParams({ secret: clave, response: token });
  if (ip && !ipLocal(ip)) cuerpo.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: cuerpo, cache: "no-store" });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
