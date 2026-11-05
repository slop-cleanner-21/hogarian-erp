"use server";

import { redirect } from "next/navigation";
import { origen, registrarEvento } from "@/lib/auditoria";
import { activarBloqueoSesion, dispositivoCon, marcarDesbloqueo } from "@/lib/bloqueo-cookies";
import { dispositivoConocido, marcarConocido } from "@/lib/dispositivo-conocido";
import { huellasAqui } from "@/lib/huella";
import { abrirSesion } from "@/lib/sesion-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";
import { contrasenaValida } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.
//
// La contraseña la verifica la base (`credenciales`, que solo lee el servidor: en Supabase Auth hay una al azar, así
// que probarlas directo contra su API no sirve). Los topes de intentos fallidos en 10 minutos (por IP y cuenta, por
// IP, y por cuenta solo para dispositivos no conocidos: nadie deja afuera al dueño sabiendo su correo) los aplica la
// misma función, de forma atómica: `ingreso_intentar` (migración prod1_ingreso_atomico).
const VENTANA_MIN = 10;
const BLOQUEADO = "Demasiados intentos";

/** En local todo llega de la misma máquina: ahí no se cuenta por IP (las pruebas simulan otra con X-Forwarded-For). */
const ipLocal = (ip: string | null) => !ip || ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip);

/** Lo que el formulario necesita saber: el error y cuántos segundos esperar. */
export type EstadoLogin = { error: string | null; espera: number } | null;

export async function login(_: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const clave = String(formData.get("password") ?? "").slice(0, 72);
  const quien = await origen();
  const { data, error } = await createAdminClient().rpc("ingreso_intentar", {
    p_email: email,
    p_clave: clave,
    p_ip: ipLocal(quien.ip) ? (null as unknown as string) : quien.ip!,
    p_conocido: (await dispositivoConocido(email)) as string,
    p_detalle: quien,
  });
  const r = data?.[0];
  if (error || !r) return { error: "No se pudo entrar, intenta de nuevo", espera: 0 };
  // Esperando: el intento no se registra (serían escrituras anónimas sin tope); ya quedaron los que llevaron aquí.
  if (r.espera > 0) return { error: BLOQUEADO, espera: r.espera };
  if (!r.user_id) return { error: "Correo o contraseña incorrectos", espera: 0 };
  const userId = r.user_id;
  const supabase = await createClient();
  const abierta = await abrirSesion(supabase, userId);
  if ("error" in abierta) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", actor: userId, detalle: { email, motivo: abierta.motivo } });
    return { error: abierta.error, espera: 0 };
  }
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: userId, actor: userId, detalle: { email } });
  await marcarConocido(email);
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
