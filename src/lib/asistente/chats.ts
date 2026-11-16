// Los chats de Hogariano: en este dispositivo (localStorage), por usuario. No guardan fotos, solo el texto. Lo que se
// conversa (montos, proveedores) queda en el teléfono de quien pregunta, como lo que ya ve en pantalla.

export type Turno = { rol: "usuario" | "asistente"; texto: string; fotos?: number; hizo?: string };
export type Chat = { id: string; titulo: string; creado: number; actualizado: number; turnos: Turno[] };
export type Guardado = { actual: string | null; chats: Chat[] };
export type Ajustes = { abrir: "ultimo" | "nuevo" };

export const MAX_CHATS = 30;
/** Turnos que se guardan por chat (al modelo se le mandan los últimos 20). */
export const MAX_TURNOS_CHAT = 60;
export const AJUSTES_DEF: Ajustes = { abrir: "ultimo" };

const claveChats = (userId: string) => `prod1_hogariano_chats:${userId}`;
const claveAjustes = (userId: string) => `prod1_hogariano_ajustes:${userId}`;

export const nuevoChat = (): Chat => {
  const ahora = Date.now();
  return { id: `${ahora.toString(36)}${Math.random().toString(36).slice(2, 7)}`, titulo: "", creado: ahora, actualizado: ahora, turnos: [] };
};

/** El título de un chat: su primera pregunta, en una línea. */
export function tituloDe(turnos: Turno[]): string {
  const p = turnos.find((t) => t.rol === "usuario");
  const t = (p?.texto || (p?.fotos ? "Foto" : "")).replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

/** Solo los chats con algo, del más reciente al más antiguo, hasta el tope (y cada uno con sus últimos turnos). */
export function podar(g: Guardado): Guardado {
  const chats = g.chats
    .filter((c) => c.turnos.length > 0 || c.id === g.actual)
    .map((c) => ({ ...c, turnos: c.turnos.slice(-MAX_TURNOS_CHAT) }))
    .sort((a, b) => b.actualizado - a.actualizado)
    .slice(0, MAX_CHATS);
  return { actual: chats.some((c) => c.id === g.actual) ? g.actual : null, chats };
}

export function leerChats(userId: string): Guardado {
  try {
    const g = JSON.parse(localStorage.getItem(claveChats(userId)) ?? "null") as Guardado | null;
    if (g && Array.isArray(g.chats)) return podar(g);
  } catch {}
  return { actual: null, chats: [] };
}

export function guardarChats(userId: string, g: Guardado) {
  let p = podar(g);
  // Sin espacio: se van quitando los más viejos.
  while (true) {
    try {
      localStorage.setItem(claveChats(userId), JSON.stringify(p));
      return;
    } catch {
      if (p.chats.length <= 1) return;
      p = { ...p, chats: p.chats.slice(0, -1) };
    }
  }
}

export function leerAjustes(userId: string): Ajustes {
  try {
    const a = JSON.parse(localStorage.getItem(claveAjustes(userId)) ?? "null") as Partial<Ajustes> | null;
    return { abrir: a?.abrir === "nuevo" ? "nuevo" : "ultimo" };
  } catch {
    return AJUSTES_DEF;
  }
}

export function guardarAjustes(userId: string, a: Ajustes) {
  try {
    localStorage.setItem(claveAjustes(userId), JSON.stringify(a));
  } catch {}
}

/** Cuándo, para la lista de chats: hora si es de hoy, «Ayer», o la fecha. */
export function cuando(ms: number, ahora = Date.now()): string {
  const d = new Date(ms);
  const dia = (x: Date) => x.toLocaleDateString("es-PE", { timeZone: "America/Lima" });
  const hoy = new Date(ahora);
  const ayer = new Date(ahora - 86_400_000);
  if (dia(d) === dia(hoy)) return d.toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (dia(d) === dia(ayer)) return "Ayer";
  return d.toLocaleDateString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit" });
}

/** ¿La respuesta trae algo que no cabe en el panel pequeño (tabla, subtítulos)? */
export const pideEspacio = (texto: string) => /^\s*\|.*\|\s*$/m.test(texto) || /^\s{0,3}#{1,6}\s/m.test(texto);
