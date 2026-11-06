// Borrador de Nueva OC / OS: lo que se lleva avanzado queda en este dispositivo (por usuario y tipo), para retomarlo si se
// sale de la pantalla o se cierra la app. Se borra al emitir la orden.

export type Borrador = {
  obraId: number;
  paso: 1 | 2;
  /** partida_id y cantidad. */
  sel: [number, string][];
  proveedorId: string | null;
  comprobante: "RXH" | "FACTURA" | null;
  fechaInicio: string;
  requiereGuia: boolean;
  guardado: number;
};

const VIGENCIA_MS = 14 * 864e5;

export const claveBorrador = (usuario: string, tipo: string) => `prod1_borrador_${usuario}_${tipo}`;

export function leerBorrador(clave: string): Borrador | null {
  try {
    const b = JSON.parse(localStorage.getItem(clave) ?? "null") as Borrador | null;
    if (!b || !Number(b.obraId) || !Array.isArray(b.sel) || Date.now() - b.guardado > VIGENCIA_MS) return null;
    return b;
  } catch {
    return null;
  }
}

export function guardarBorrador(clave: string, b: Omit<Borrador, "guardado">) {
  try {
    localStorage.setItem(clave, JSON.stringify({ ...b, guardado: Date.now() }));
  } catch {}
}

export function borrarBorrador(clave: string) {
  try {
    localStorage.removeItem(clave);
  } catch {}
}
