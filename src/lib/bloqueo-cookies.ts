import "server-only";
import { cookies } from "next/headers";
import { COOKIE_DESBLOQUEO, COOKIE_DISPOSITIVO, desbloqueoPara, firmar, leerFirmado, opcionesDesbloqueo, opcionesDispositivo } from "./bloqueo-servidor";

// Las cookies del bloqueo con huella desde las acciones (no son server actions: solo las llama el servidor tras
// verificar la contraseña o la huella; exportadas desde un archivo «use server» se podrían llamar desde el navegador).

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
