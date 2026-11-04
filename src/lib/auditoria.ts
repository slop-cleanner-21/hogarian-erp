import "server-only";
import { headers } from "next/headers";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/** Eventos que la app registra en la auditoría (los cambios de tablas los registra la base sola). */
export type EventoApp =
  | { tabla: "sesion"; accion: "LOGIN" | "LOGIN_FALLIDO" | "LOGOUT" | "CAMBIO_CONTRASENA" | "DESBLOQUEO" | "DESBLOQUEO_FALLIDO" | "CAPTCHA_IP" }
  | { tabla: "usuarios"; accion: "CREAR_USUARIO" | "EDITAR_USUARIO" | "RESTABLECER_CONTRASENA" | "DESACTIVAR" | "REACTIVAR" };

/** IP y dispositivo de quien hace la petición (detrás de Vercel o del túnel, la del cliente real). */
export async function origen() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip, agente: h.get("user-agent")?.slice(0, 300) ?? null };
}

/**
 * Registra un evento de la app en la auditoría (con la clave secreta: solo lo escribe el servidor).
 * Si falla, no corta la acción del usuario: la auditoría no debe impedir trabajar.
 */
export async function registrarEvento(
  evento: EventoApp & { registro?: string | null; detalle?: Record<string, unknown>; actor?: string | null },
) {
  try {
    const db = createAdminClient();
    await db.from("audit_log").insert({
      user_id: evento.actor ?? null,
      tabla: evento.tabla,
      registro: evento.registro ?? null,
      accion: evento.accion,
      detalle: { ...(await origen()), ...(evento.detalle ?? {}) } as Json,
    });
  } catch {
    // Sin auditoría no se detiene la app.
  }
}
