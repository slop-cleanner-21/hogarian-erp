"use server";

import { redirect } from "next/navigation";
import { origen, registrarEvento } from "@/lib/auditoria";
import { marcarDesbloqueo } from "@/lib/bloqueo-cookies";
import { captchaDisponible, captchaEnSupabase, espera, estadoIp, falloIp, ipLocal, verificarCaptcha } from "@/lib/captcha";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MIN_CONTRASENA } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.

// Contra la fuerza bruta: intentos fallidos en los últimos 15 minutos, por cuenta y por IP (la del celular, no
// la del servidor). Se corta antes de llamar a Supabase: así un ataque tampoco agota su límite, que ve la IP
// del servidor y es el mismo para todos.
const VENTANA_MIN = 15;
const MAX_POR_CUENTA = 10;
const MAX_POR_IP = 30;
const BLOQUEADO = `Demasiados intentos. Vuelve a intentarlo en ${VENTANA_MIN} minutos.`;

/** Intentos fallidos recientes (15 min) por cuenta y por IP. */
async function fallosRecientes(email: string, ip: string | null) {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const db = createAdminClient();
  const fallidos = (campo: "email" | "ip", valor: string) =>
    db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("tabla", "sesion")
      .eq("accion", "LOGIN_FALLIDO")
      .gte("created_at", desde)
      .eq(`detalle->>${campo}`, valor);
  // En local todo llega de la misma máquina (::1): ahí solo cuenta por cuenta.
  const [cuenta, porIp] = await Promise.all([fallidos("email", email), ipLocal(ip) ? Promise.resolve({ count: 0 }) : fallidos("ip", ip!)]);
  return { cuenta: cuenta.count ?? 0, ip: porIp.count ?? 0 };
}

/** Lo que el formulario necesita saber: el error, si debe mostrar el CAPTCHA y cuántos segundos esperar. */
export type EstadoLogin = { error: string | null; captcha: boolean; espera: number } | null;

const VERIFICACION = "Completa la verificación";

export async function login(_: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const token = String(formData.get("cf-turnstile-response") ?? "");
  const { ip } = await origen();
  const [recientes, ipEstado] = await Promise.all([fallosRecientes(email, ip), estadoIp(ip)]);
  const conCaptcha = ipEstado.captcha && captchaDisponible();

  // Bloqueado o esperando: no se registra cada intento (serían escrituras anónimas sin tope); ya quedaron los que
  // llevaron aquí.
  if (recientes.cuenta >= MAX_POR_CUENTA || recientes.ip >= MAX_POR_IP) return { error: BLOQUEADO, captcha: conCaptcha, espera: 0 };
  const esperar = espera(ipEstado, recientes.ip);
  if (esperar > 0) return { error: `Espera ${esperar} s para volver a intentarlo`, captcha: conCaptcha, espera: esperar };

  // IP que ya falló 3 veces: CAPTCHA siempre. Si Supabase lo exige (producción), él verifica el token (de un solo uso).
  if (conCaptcha && !token) return { error: VERIFICACION, captcha: true, espera: 0 };
  if (conCaptcha && !captchaEnSupabase() && !(await verificarCaptcha(token, ip))) return { error: VERIFICACION, captcha: true, espera: 0 };

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(formData.get("password") ?? ""),
    options: captchaEnSupabase() && token ? { captchaToken: token } : undefined,
  });
  if (error) {
    // Sin el token o con uno vencido (Supabase lo exige): no cuenta como intento fallido.
    if (error.code === "captcha_failed") return { error: VERIFICACION, captcha: conCaptcha, espera: 0 };
    const [{ captcha, nuevo }] = await Promise.all([
      falloIp(ip),
      registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", detalle: { email, motivo: error.code ?? error.message } }),
    ]);
    if (nuevo) await registrarEvento({ tabla: "sesion", accion: "CAPTCHA_IP", detalle: { email } });
    return { error: "Correo o contraseña incorrectos", captcha: captcha && captchaDisponible(), espera: 0 };
  }
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: data.user.id, actor: data.user.id, detalle: { email } });
  // Entró: el dispositivo queda desbloqueado (y la huella de otra persona en él deja de valer).
  await marcarDesbloqueo(data.user.id);
  redirect("/");
}

/** El usuario cambia su propia contraseña (p. ej. la temporal que le dio el Admin). */
export async function cambiarMiContrasena(nueva: string): Promise<string | null> {
  if (nueva.length < MIN_CONTRASENA) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres`;
  if (nueva.length > 72) return "La contraseña es demasiado larga";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password: nueva });
  if (!error) {
    await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA", registro: data.user.id, actor: data.user.id });
    return null;
  }
  if (error.code === "same_password") return "Es la misma contraseña que ya tienes";
  return error.message;
}
