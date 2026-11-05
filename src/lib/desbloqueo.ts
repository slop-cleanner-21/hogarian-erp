import "server-only";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { after } from "next/server";
import { registrarEvento } from "@/lib/auditoria";
import { desbloquearSesion, marcarDesbloqueo, olvidarDispositivo, quitarBloqueoSesion } from "@/lib/bloqueo-cookies";
import { huellasAqui, huellasDe, opcionesFirmar, verificarFirma } from "@/lib/huella";
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
 * Opciones para firmar con la huella. Si al usuario no le queda ninguna huella (las quitó desde otro dispositivo) no
 * hay nada que pedir: sus sesiones dejan de bloquearse y el dispositivo deja de pedirla. Si tiene, pero ninguna de
 * este dominio, no se desbloquea (`sinHuellaAqui`): queda «Usar contraseña».
 */
export async function opcionesParaDesbloquear({ userId }: { userId: string }) {
  if ((await huellasAqui(userId)) === 0) {
    if ((await huellasDe(userId)).length > 0) return { sinHuellaAqui: true as const };
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
