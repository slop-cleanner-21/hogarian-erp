"use server";

import { redirect } from "next/navigation";
import { origen, registrarEvento } from "@/lib/auditoria";
import { activarBloqueoSesion, dispositivoCon, marcarDesbloqueo } from "@/lib/bloqueo-cookies";
import { captchaDisponible, captchaEnSupabase, espera, estadoIp, falloIp, ipLocal, verificarCaptcha } from "@/lib/captcha";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";
import { contrasenaValida } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.

// Contra la fuerza bruta: intentos fallidos en los últimos 15 minutos, por cuenta y por IP (la del celular, no
// la del servidor). Se corta antes de llamar a Supabase: así un ataque tampoco agota su límite, que ve la IP
// del servidor y es el mismo para todos.
const VENTANA_MIN = 15;
const MAX_POR_CUENTA = 10;
const MAX_POR_IP = 30;
const BLOQUEADO = `Demasiados intentos. Vuelve a intentarlo en ${VENTANA_MIN} minutos.`;

/** Intentos fallidos recientes (15 min) por cuenta, por IP y por los dos juntos (con el último de esos). */
async function fallosRecientes(email: string, ip: string | null) {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const db = createAdminClient();
  const fallidos = (filtro: Record<string, string>) => {
    let q = db.from("audit_log").select("created_at", { count: "exact" }).eq("tabla", "sesion").eq("accion", "LOGIN_FALLIDO").gte("created_at", desde);
    for (const [campo, valor] of Object.entries(filtro)) q = q.eq(`detalle->>${campo}`, valor);
    return q.order("created_at", { ascending: false }).limit(1);
  };
  // En local todo llega de la misma máquina (::1): ahí solo cuenta por cuenta.
  const nada = Promise.resolve({ count: 0, data: [] as { created_at: string }[] });
  const [cuenta, porIp, par] = await Promise.all([
    fallidos({ email }),
    ipLocal(ip) ? nada : fallidos({ ip: ip! }),
    ipLocal(ip) ? nada : fallidos({ ip: ip!, email }),
  ]);
  const ultimo = par.data?.[0]?.created_at;
  return { cuenta: cuenta.count ?? 0, ip: porIp.count ?? 0, par: par.count ?? 0, ultimoPar: ultimo ? Date.parse(ultimo) : null };
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
  // Una cuenta con muchos intentos fallidos (desde cualquier IP) pide CAPTCHA en vez de bloquearse: así nadie deja
  // afuera a otro (p. ej. al Admin) a propósito. Sin CAPTCHA (sin claves), se bloquea 15 minutos.
  const cuentaAtacada = recientes.cuenta >= MAX_POR_CUENTA;
  const conCaptcha = captchaDisponible() && (ipEstado.captcha || cuentaAtacada);

  // Bloqueado o esperando: no se registra cada intento (serían escrituras anónimas sin tope); ya quedaron los que
  // llevaron aquí.
  if (recientes.ip >= MAX_POR_IP || (cuentaAtacada && !captchaDisponible())) return { error: BLOQUEADO, captcha: conCaptcha, espera: 0 };
  // La espera es por IP y cuenta juntas: en una oficina (todos con la misma IP), los fallos de uno no hacen esperar
  // a los demás (el CAPTCHA sí queda para toda la IP).
  const esperar = espera(recientes.par, recientes.ultimoPar);
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
  // Entró: el dispositivo queda desbloqueado (y la huella de otra persona en él deja de valer). Si tiene su huella,
  // esta sesión nueva también se bloquea al cerrar la app.
  if (await dispositivoCon(data.user.id)) await activarBloqueoSesion(supabase, true);
  await marcarDesbloqueo(data.user.id);
  redirect("/");
}

const MAX_CAMBIO_FALLIDO = 5;

/**
 * El usuario cambia su propia contraseña (p. ej. la temporal que le dio el Admin), con la actual: un token robado no
 * basta para quedarse con la cuenta. La actual la verifica la base (sin abrir otra sesión) y el cambio lo hace el
 * servidor; Supabase Auth exige además reautenticarse para cambiarla directo por la API (secure_password_change).
 */
export async function cambiarMiContrasena(actual: string, nueva: string): Promise<string | null> {
  const sesion = await requireSesionVigente();
  const invalida = contrasenaValida(nueva);
  if (invalida) return invalida;
  const db = createAdminClient(sesion.userId);
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { count } = await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("tabla", "sesion")
    .eq("accion", "CAMBIO_CONTRASENA_FALLIDO")
    .eq("registro", sesion.userId)
    .gte("created_at", desde);
  if ((count ?? 0) >= MAX_CAMBIO_FALLIDO) return BLOQUEADO;
  const correcta = async (clave: string) => (await db.rpc("contrasena_correcta", { p_user: sesion.userId, p_clave: clave })).data === true;
  if (!actual || !(await correcta(actual.slice(0, 72)))) {
    await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA_FALLIDO", registro: sesion.userId, actor: sesion.userId });
    return "La contraseña actual no es correcta";
  }
  if (actual === nueva) return "Es la misma contraseña que ya tienes";
  const { error } = await db.auth.admin.updateUserById(sesion.userId, { password: nueva });
  if (error) return error.message;
  await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA", registro: sesion.userId, actor: sesion.userId });
  return null;
}
