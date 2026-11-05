"use server";

import { redirect } from "next/navigation";
import { origen, registrarEvento } from "@/lib/auditoria";
import { activarBloqueoSesion, dispositivoCon, marcarDesbloqueo } from "@/lib/bloqueo-cookies";
import { huellasAqui } from "@/lib/huella";
import { abrirSesion } from "@/lib/sesion-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";
import { contrasenaValida } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.
//
// La contraseña la verifica el servidor (`credenciales`, que solo lee él: en Supabase Auth hay una al azar, así que
// probarlas directo contra su API no sirve). Contra la fuerza bruta, intentos fallidos en los últimos 10 minutos:
// 3 por cuenta (desde cualquier IP) y 10 por IP (sin bloquear a toda una oficina por los errores de uno). Pasado el
// tope, espera hasta que el más viejo de esos intentos cumpla los 10 minutos. Se corta antes de verificar nada.
const VENTANA_MIN = 10;
const MAX_POR_CUENTA = 3;
const MAX_POR_IP = 10;
const BLOQUEADO = "Demasiados intentos";

/** En local todo llega de la misma máquina: ahí no se cuenta por IP (las pruebas simulan otra con X-Forwarded-For). */
const ipLocal = (ip: string | null) => !ip || ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip);

/** Intentos fallidos recientes por cuenta y por IP, con el más viejo de cada uno (para saber cuánto esperar). */
async function fallosRecientes(email: string, ip: string | null) {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const db = createAdminClient();
  const fallidos = async (campo: "email" | "ip", valor: string) => {
    const { count, data } = await db
      .from("audit_log")
      .select("created_at", { count: "exact" })
      .eq("tabla", "sesion")
      .eq("accion", "LOGIN_FALLIDO")
      .gte("created_at", desde)
      .eq(`detalle->>${campo}`, valor)
      .order("created_at", { ascending: true })
      .limit(1);
    return { n: count ?? 0, primero: data?.[0] ? Date.parse(data[0].created_at) : null };
  };
  const [cuenta, porIp] = await Promise.all([fallidos("email", email), ipLocal(ip) ? { n: 0, primero: null } : fallidos("ip", ip!)]);
  return { cuenta, ip: porIp };
}

/** Segundos hasta poder reintentar (0: puede). */
function espera({ n, primero }: { n: number; primero: number | null }, maximo: number) {
  if (n < maximo || !primero) return 0;
  return Math.max(1, Math.ceil((primero + VENTANA_MIN * 60_000 - Date.now()) / 1000));
}

/** Lo que el formulario necesita saber: el error y cuántos segundos esperar. */
export type EstadoLogin = { error: string | null; espera: number } | null;

export async function login(_: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const clave = String(formData.get("password") ?? "").slice(0, 72);
  const { ip } = await origen();
  const recientes = await fallosRecientes(email, ip);
  // Esperando: no se registra cada intento (serían escrituras anónimas sin tope); ya quedaron los que llevaron aquí.
  const esperar = Math.max(espera(recientes.cuenta, MAX_POR_CUENTA), espera(recientes.ip, MAX_POR_IP));
  if (esperar > 0) return { error: BLOQUEADO, espera: esperar };

  const { data: userId } = await createAdminClient().rpc("ingreso_valido", { p_email: email, p_clave: clave });
  if (!userId) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", detalle: { email, motivo: "invalid_credentials" } });
    return { error: "Correo o contraseña incorrectos", espera: 0 };
  }
  const supabase = await createClient();
  const abierta = await abrirSesion(supabase, userId);
  if ("error" in abierta) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", actor: userId, detalle: { email, motivo: abierta.motivo } });
    return { error: abierta.error, espera: 0 };
  }
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: userId, actor: userId, detalle: { email } });
  // Entró: el dispositivo queda desbloqueado (y la huella de otra persona en él deja de valer). Si tiene su huella
  // (de este dominio), esta sesión nueva también se bloquea al cerrar la app.
  if ((await dispositivoCon(userId)) && (await huellasAqui(userId)) > 0) await activarBloqueoSesion(supabase, true);
  await marcarDesbloqueo(userId);
  redirect("/");
}

const MAX_CAMBIO_FALLIDO = 5;

/**
 * El usuario cambia su propia contraseña (p. ej. la temporal que le dio el Admin), con la actual: un token robado no
 * basta para quedarse con la cuenta (y cambiarla directo en Supabase Auth no sirve: no es la que vale). La verifica y
 * la fija la base (`credenciales`), y se cierran sus demás sesiones.
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
  if ((count ?? 0) >= MAX_CAMBIO_FALLIDO) return `Demasiados intentos. Vuelve a intentarlo en ${VENTANA_MIN} minutos.`;
  const correcta = async (clave: string) => (await db.rpc("contrasena_correcta", { p_user: sesion.userId, p_clave: clave })).data === true;
  if (!actual || !(await correcta(actual.slice(0, 72)))) {
    await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA_FALLIDO", registro: sesion.userId, actor: sesion.userId });
    return "La contraseña actual no es correcta";
  }
  if (actual === nueva) return "Es la misma contraseña que ya tienes";
  const { data: c } = await (await createClient()).auth.getClaims();
  const sid = typeof c?.claims?.session_id === "string" ? c.claims.session_id : undefined;
  const { error } = await db.rpc("fijar_contrasena", { p_user: sesion.userId, p_clave: nueva, p_conservar: sid });
  if (error) return error.message;
  await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA", registro: sesion.userId, actor: sesion.userId });
  return null;
}
