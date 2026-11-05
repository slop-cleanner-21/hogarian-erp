"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import { dispositivo } from "@/lib/auditoria-reporte";
import { origen, registrarEvento } from "@/lib/auditoria";
import { activarBloqueoSesion, marcarDispositivo, olvidarDispositivo, quitarBloqueoSesion, soloMarcarDispositivo } from "@/lib/bloqueo-cookies";
import { huellasDe, opcionesActivar, opcionesFirmar, verificarActivacion, verificarFirma, type Huella } from "@/lib/huella";
import { abrirSesion } from "@/lib/sesion-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";

// Entrar y desbloquear con huella. Cada inicio de sesión, desbloqueo, intento fallido, activación y baja queda en la
// auditoría (las altas y bajas también por el trigger de la tabla). El bloqueo lo hace cumplir también el servidor
// (src/lib/bloqueo-servidor.ts): estas acciones ponen sus cookies solo tras verificar la huella.

const FALLO = "No se reconoció la huella";

// ── Entrar (login, sin sesión) ──

export async function opcionesEntrar() {
  return opcionesFirmar(null);
}

export type ResultadoHuella = { error: string; desconocida?: boolean };

/** Verifica la huella y abre la sesión de su dueño (un enlace mágico de un solo uso, canjeado en el servidor). */
export async function entrarConHuella(respuesta: AuthenticationResponseJSON): Promise<ResultadoHuella> {
  const f = await verificarFirma(respuesta, null);
  if (!f.ok) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", detalle: { metodo: "huella", motivo: f.desconocida ? "huella quitada" : "firma" } });
    return { error: FALLO, desconocida: f.desconocida };
  }
  const userId = f.userId;
  const supabase = await createClient();
  const abierta = await abrirSesion(supabase, userId);
  if ("error" in abierta) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", actor: userId, detalle: { metodo: "huella", motivo: abierta.motivo } });
    return { error: abierta.motivo === "desactivada" ? abierta.error : FALLO };
  }
  const email = abierta.email;
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: userId, actor: userId, detalle: { email, metodo: "huella" } });
  // Este dispositivo tiene su huella y queda desbloqueado (la sesión nueva, con bloqueo en la base).
  await activarBloqueoSesion(supabase, true);
  await marcarDispositivo(userId);
  redirect("/");
}

// ── Desbloquear: por rutas bajo /desbloquear (src/lib/desbloqueo.ts), que funcionan con la pantalla bloqueada ──

// ── Activar y quitar (menú del usuario) ──

export async function misHuellas(): Promise<{ userId: string; email: string; huellas: Huella[] }> {
  const sesion = await requireSesionVigente();
  const [{ data }, huellas] = await Promise.all([createAdminClient().auth.admin.getUserById(sesion.userId), huellasDe(sesion.userId)]);
  return { userId: sesion.userId, email: data.user?.email ?? "", huellas };
}

export async function opcionesActivarHuella() {
  const sesion = await requireSesionVigente();
  const { data } = await createAdminClient().auth.admin.getUserById(sesion.userId);
  if (!data.user?.email) throw new Error("Sin correo");
  return opcionesActivar({ id: sesion.userId, email: data.user.email, nombre: sesion.nombre });
}

export async function activarHuella(
  respuesta: RegistrationResponseJSON,
): Promise<{ userId: string; credentialId: string; email: string } | null> {
  const sesion = await requireSesionVigente();
  const h = await verificarActivacion(sesion.userId, respuesta, dispositivo((await origen()).agente));
  if (!h) return null;
  await activarBloqueoSesion(await createClient(), true);
  await marcarDispositivo(sesion.userId);
  const { data } = await createAdminClient().auth.admin.getUserById(sesion.userId);
  return { userId: sesion.userId, credentialId: h.credential_id, email: data.user?.email ?? "" };
}

/** La huella ya estaba activada en este teléfono (el navegador lo dijo al querer activarla de nuevo): lo marca para
 *  el bloqueo del servidor. Solo lo hace más estricto para la propia sesión (no desbloquea nada). */
export async function yaActivadaAqui() {
  const sesion = await requireSesionVigente();
  await activarBloqueoSesion(await createClient(), true);
  await soloMarcarDispositivo(sesion.userId);
}

/** Quita una huella. `esteDispositivo`: es la de este teléfono (o al usuario no le queda ninguna): deja de pedirla aquí. */
export async function quitarHuella(id: string, esteDispositivo = false): Promise<boolean> {
  const sesion = await requireSesionVigente();
  const { error, count } = await createAdminClient(sesion.userId)
    .from("huellas")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", sesion.userId);
  const ok = !error && count === 1;
  if (!ok) return false;
  const ninguna = (await huellasDe(sesion.userId)).length === 0;
  if (esteDispositivo || ninguna) {
    const { data } = await (await createClient()).auth.getClaims();
    const sid = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
    // Sin huellas, ninguna sesión suya queda con bloqueo; si no, solo esta (las demás siguen en sus dispositivos).
    await quitarBloqueoSesion(ninguna ? null : sid, sesion.userId);
    await olvidarDispositivo();
  }
  return true;
}
