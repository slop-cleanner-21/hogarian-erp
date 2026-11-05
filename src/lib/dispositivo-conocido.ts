import "server-only";
import { cookies } from "next/headers";
import { firmar, leerFirmado, opcionesCookie } from "./bloqueo-servidor";

// «Dispositivo conocido»: este navegador ya entró con esta cuenta (contraseña o huella). Lo marca el servidor con
// una cookie firmada (httpOnly: el navegador no la lee ni la fabrica). Los intentos fallidos de otros sobre la
// cuenta (desde otras IP) no frenan a un dispositivo conocido: así nadie deja afuera al dueño sabiendo su correo
// (migración prod1_ingreso_atomico).

const COOKIE = "prod1_conocido";
const UN_ANIO = 60 * 60 * 24 * 365;

/** El id de este dispositivo para esa cuenta (null si no es conocido para ella). */
export async function dispositivoConocido(email: string): Promise<string | null> {
  const v = await leerFirmado((await cookies()).get(COOKIE)?.value);
  if (!v) return null;
  const [marca, id, ...resto] = v.split(":");
  return marca === "conocido" && resto.join(":") === email.toLowerCase() ? id : null;
}

/** Entró con esta cuenta: el dispositivo queda conocido para ella (conserva su id si ya lo era). */
export async function marcarConocido(email: string) {
  const correo = email.toLowerCase();
  const id = (await dispositivoConocido(correo)) ?? crypto.randomUUID();
  (await cookies()).set(COOKIE, await firmar(`conocido:${id}:${correo}`), opcionesCookie(UN_ANIO));
}
