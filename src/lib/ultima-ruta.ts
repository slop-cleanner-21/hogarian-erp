/** Cookie con la última pantalla visitada: «/» redirige a ella desde el servidor (sin pantalla en blanco). */
export const COOKIE_ULTIMA = "prod1_ultima";

/**
 * Pantallas que no se retoman: entrada, acceso, el link público del proveedor, el bloqueo con huella, la bienvenida y el
 * cambio de rol. El bloqueo, sobre todo: desbloquear vuelve a «/», y si «/» llevara al bloqueo no se saldría nunca.
 */
export const NO_RETOMAR = ["/login", "/acceso", "/cotizar", "/voucher-simulado", "/comprobante-simulado", "/desbloquear", "/bienvenida", "/sin-acceso", "/rol"];

export const seRetoma = (ruta: string) => ruta.startsWith("/") && !ruta.startsWith("//") && ruta !== "/" && !NO_RETOMAR.some((p) => ruta === p || ruta.startsWith(`${p}?`) || ruta.startsWith(`${p}/`));
