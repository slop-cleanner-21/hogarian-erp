// Preferencias de vista guardadas en el dispositivo (localStorage). Solo comodidad: si el
// almacenamiento no está disponible (modo privado, bloqueado), todo funciona sin recordar.

const PREFIJO = "erp:";

export function leer<T>(clave: string): T | null {
  try {
    const v = localStorage.getItem(PREFIJO + clave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function guardar(clave: string, valor: unknown) {
  try {
    if (valor == null) localStorage.removeItem(PREFIJO + clave);
    else localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento: no se recuerda.
  }
}
