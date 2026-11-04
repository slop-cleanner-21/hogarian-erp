"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import { dispositivo } from "@/lib/auditoria-reporte";
import { origen, registrarEvento } from "@/lib/auditoria";
import { huellasDe, opcionesActivar, opcionesFirmar, verificarActivacion, verificarFirma, type Huella } from "@/lib/huella";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";

// Entrar y desbloquear con huella. Cada inicio de sesión, desbloqueo, intento fallido, activación y baja queda en la
// auditoría (las altas y bajas también por el trigger de la tabla).

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
  const admin = createAdminClient(userId);
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u.user?.email;
  const baneado = u.user?.banned_until && new Date(u.user.banned_until) > new Date();
  if (!email || baneado) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", actor: userId, detalle: { email, metodo: "huella", motivo: "desactivada" } });
    return { error: "La cuenta está desactivada" };
  }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) return { error: FALLO };
  const supabase = await createClient();
  const { error: e2 } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (e2) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", actor: userId, detalle: { email, metodo: "huella", motivo: e2.code ?? e2.message } });
    return { error: FALLO };
  }
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: userId, actor: userId, detalle: { email, metodo: "huella" } });
  redirect("/");
}

// ── Desbloquear (con sesión: la app se bloquea al volver tras un rato) ──

export async function opcionesDesbloquear() {
  const sesion = await requireSesionVigente();
  return opcionesFirmar(sesion.userId);
}

export async function desbloquear(respuesta: AuthenticationResponseJSON): Promise<boolean> {
  const sesion = await requireSesionVigente();
  const ok = (await verificarFirma(respuesta, sesion.userId)).ok;
  await registrarEvento({
    tabla: "sesion",
    accion: ok ? "DESBLOQUEO" : "DESBLOQUEO_FALLIDO",
    registro: sesion.userId,
    actor: sesion.userId,
  });
  return ok;
}

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
  const { data } = await createAdminClient().auth.admin.getUserById(sesion.userId);
  return { userId: sesion.userId, credentialId: h.credential_id, email: data.user?.email ?? "" };
}

export async function quitarHuella(id: string): Promise<boolean> {
  const sesion = await requireSesionVigente();
  const { error, count } = await createAdminClient(sesion.userId)
    .from("huellas")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", sesion.userId);
  return !error && count === 1;
}
