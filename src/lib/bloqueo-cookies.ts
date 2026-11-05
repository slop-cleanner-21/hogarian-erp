import "server-only";
import { cookies } from "next/headers";
import { COOKIE_DESBLOQUEO, COOKIE_DISPOSITIVO, COOKIE_LIBRE, desbloqueoPara, firmar, leerFirmado, opcionesDesbloqueo, opcionesDispositivo } from "./bloqueo-servidor";
import { createAdminClient } from "./supabase/admin";
import type { createClient } from "./supabase/server";

// Las cookies del bloqueo con huella desde las acciones (no son server actions: solo las llama el servidor tras
// verificar la contraseña o la huella; exportadas desde un archivo «use server» se podrían llamar desde el navegador).
// Y el bloqueo en la base (sesiones_bloqueo), que es el que manda: las cookies solo ahorran preguntarle.

/** Al entrar (contraseña o huella) o desbloquear: desbloqueado. Si la huella del dispositivo es de otro, se olvida. */
export async function marcarDesbloqueo(userId: string) {
  const jar = await cookies();
  const dueno = await leerFirmado(jar.get(COOKIE_DISPOSITIVO)?.value);
  if (dueno && dueno !== userId) jar.delete(COOKIE_DISPOSITIVO);
  jar.set(COOKIE_DESBLOQUEO, await desbloqueoPara(userId), opcionesDesbloqueo());
}

/** Este dispositivo tiene la huella activada para el usuario (y queda desbloqueado). */
export async function marcarDispositivo(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE_DISPOSITIVO, await firmar(userId), opcionesDispositivo());
  jar.set(COOKIE_DESBLOQUEO, await desbloqueoPara(userId), opcionesDesbloqueo());
}

/** Solo la marca de la huella del dispositivo (sin desbloquear). */
export async function soloMarcarDispositivo(userId: string) {
  (await cookies()).set(COOKIE_DISPOSITIVO, await firmar(userId), opcionesDispositivo());
}

/** La huella ya no vale en este dispositivo (se quitó, o no le queda ninguna). */
export async function olvidarDispositivo() {
  (await cookies()).delete(COOKIE_DISPOSITIVO);
}

export async function quitarDesbloqueo() {
  (await cookies()).delete(COOKIE_DESBLOQUEO);
}

// ── En la base ──

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** La huella del dispositivo pasa a bloquear esta sesión (con el cliente de la sesión recién abierta o la actual).
 *  `abierta`: recién verificada (contraseña o huella), queda desbloqueada. Nunca desbloquea una ya bloqueada. */
export async function activarBloqueoSesion(supabase: Cliente, abierta: boolean) {
  const { error } = await supabase.rpc("bloqueo_activar", { p_abierta: abierta });
  if (error) throw new Error(`No se pudo activar el bloqueo: ${error.message}`);
  (await cookies()).delete(COOKIE_LIBRE);
}

/** Si el dispositivo tiene la huella de este usuario (la cookie firmada). */
export async function dispositivoCon(userId: string) {
  return (await leerFirmado((await cookies()).get(COOKIE_DISPOSITIVO)?.value)) === userId;
}

/** Tras verificar la huella: la sesión queda desbloqueada (solo el servidor puede). */
export async function desbloquearSesion(sesionId: string) {
  const { error } = await createAdminClient().rpc("bloqueo_desbloquear", { p_session: sesionId });
  if (error) throw new Error(`No se pudo desbloquear: ${error.message}`);
}

/** La huella ya no bloquea esta sesión (`sesionId`) o ninguna del usuario (`sesionId` null: no le quedan huellas). */
export async function quitarBloqueoSesion(sesionId: string | null, userId: string) {
  await createAdminClient().rpc("bloqueo_quitar", { p_session: sesionId as string, p_user: userId });
}
