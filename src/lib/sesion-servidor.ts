import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

// Abrir la sesión de un usuario ya verificado por el servidor (su contraseña en `credenciales`, o su huella). Las
// contraseñas no están en Supabase Auth (migración prod1_credenciales): la sesión se abre con un enlace mágico de un
// solo uso, generado y canjeado aquí mismo (no viaja por correo ni pasa por el navegador).

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Abre la sesión en el cliente de este pedido (pone sus cookies). Devuelve el correo, o el motivo si no se pudo. */
export async function abrirSesion(supabase: Cliente, userId: string): Promise<{ email: string } | { error: string; motivo: string }> {
  const admin = createAdminClient(userId);
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u.user?.email;
  if (!email) return { error: "No se pudo entrar", motivo: "sin correo" };
  if (u.user?.banned_until && new Date(u.user.banned_until) > new Date()) return { error: "La cuenta está desactivada", motivo: "desactivada" };
  // Auth guarda un solo enlace por usuario: si la misma cuenta entra a la vez en otro lado, el otro enlace reemplaza
  // a este y su canje falla («otp_expired»). Se reintenta con uno nuevo.
  let motivo = "sin enlace";
  for (let intento = 0; intento < 4; intento++) {
    if (intento) await new Promise((r) => setTimeout(r, 100 + Math.random() * 300));
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link.properties?.hashed_token) return { error: "No se pudo entrar", motivo: error?.code ?? error?.message ?? motivo };
    const { error: e2 } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (!e2) return { email };
    motivo = e2.code ?? e2.message;
    if (e2.code !== "otp_expired") break;
  }
  return { error: "No se pudo entrar", motivo };
}
