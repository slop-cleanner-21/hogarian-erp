import "server-only";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { after } from "next/server";
import { registrarEvento } from "@/lib/auditoria";
import { desbloquearSesion, marcarDesbloqueo, olvidarDispositivo, quitarBloqueoSesion } from "@/lib/bloqueo-cookies";
import { huellasAqui, opcionesFirmar, verificarFirma } from "@/lib/huella";
import { createClient } from "@/lib/supabase/server";

// Desbloquear con huella (la pantalla /desbloquear y el bloqueo dentro de la app). Va por rutas bajo /desbloquear,
// que el proxy deja pasar aunque el «desbloqueado» haya vencido (con server actions en la página bloqueada, el
// proxy las rechazaría y no habría cómo desbloquear). El desbloqueo solo se da tras verificar la huella.

/** El usuario y la sesión (sin redirigir: lo piden rutas que responden JSON). */
export async function usuarioDeSesion(): Promise<{ userId: string; sesionId: string } | null> {
  const { data } = await (await createClient()).auth.getClaims();
  const c = data?.claims;
  return c?.sub && typeof c.session_id === "string" ? { userId: c.sub, sesionId: c.session_id } : null;
}

/**
 * Opciones para firmar con la huella. Sin ninguna huella en este dominio (se quitaron desde otro dispositivo, o la
 * marca es de otra persona) no hay nada que pedir: el dispositivo deja de pedirla y queda desbloqueado.
 */
export async function opcionesParaDesbloquear({ userId }: { userId: string }) {
  if ((await huellasAqui(userId)) === 0) {
    await quitarBloqueoSesion(null, userId);
    await olvidarDispositivo();
    await marcarDesbloqueo(userId);
    return null;
  }
  return opcionesFirmar(userId);
}

export async function verificarDesbloqueo({ userId, sesionId }: { userId: string; sesionId: string }, respuesta: AuthenticationResponseJSON): Promise<boolean> {
  const ok = (await verificarFirma(respuesta, userId)).ok;
  if (ok) {
    await desbloquearSesion(sesionId);
    await marcarDesbloqueo(userId);
  }
  after(() => registrarEvento({ tabla: "sesion", accion: ok ? "DESBLOQUEO" : "DESBLOQUEO_FALLIDO", registro: userId, actor: userId }));
  return ok;
}
