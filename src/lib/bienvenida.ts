import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Link de bienvenida (migración prod1_bienvenida): el Admin lo genera para una cuenta y se lo pasa al usuario; al
// abrirlo, completa sus datos y crea su contraseña. Sirve una sola vez y vence a los DIAS días. La base guarda solo el
// hash del token: quien lea la tabla no puede armar el link.

export const DIAS = 7;
export const RUTA = "/bienvenida";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** El dominio de la app tal como llegó el pedido (Vercel o localhost). */
async function origenApp() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Un link nuevo para la cuenta (los anteriores sin usar dejan de servir). Devuelve el link y hasta cuándo vale. */
export async function crearLink(userId: string, actor: string): Promise<{ url: string; vence: string } | { error: string }> {
  const db = createAdminClient(actor);
  const token = randomBytes(32).toString("base64url");
  const vence = new Date(Date.now() + DIAS * 86_400_000).toISOString();
  const { error: e1 } = await db.from("invitaciones").update({ expira_at: new Date().toISOString() }).eq("user_id", userId).is("usada_at", null);
  if (e1) return { error: e1.message };
  const { error } = await db.from("invitaciones").insert({ user_id: userId, token_hash: hashToken(token), creada_por: actor, expira_at: vence });
  if (error) return { error: error.message };
  return { url: `${await origenApp()}${RUTA}/${token}`, vence };
}

/** Los links sin usar de la cuenta dejan de servir (p. ej. el Admin le dio una contraseña temporal). */
export async function invalidarLinks(userId: string, actor: string) {
  await createAdminClient(actor).from("invitaciones").update({ expira_at: new Date().toISOString() }).eq("user_id", userId).is("usada_at", null);
}

/**
 * El link lo acaba de usar este mismo usuario (hace menos de 10 minutos): la página sigue con el paso de la huella. (Al
 * guardar, la sesión nueva pone cookies y Next vuelve a pedir la página: sin esto diría «Este link ya no sirve».)
 */
export async function recienUsado(token: string, userId: string | null): Promise<boolean> {
  if (!userId || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return false;
  const { data } = await createAdminClient()
    .from("invitaciones")
    .select("user_id, usada_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  return !!data?.usada_at && data.user_id === userId && Date.now() - new Date(data.usada_at).getTime() < 10 * 60_000;
}

export type Invitacion = { userId: string; email: string; nombre: string; rol: string; dni: string; telefono: string; vence: string };

/** La invitación del link, si todavía sirve (sin usar, sin vencer, cuenta activa). */
export async function leerInvitacion(token: string): Promise<Invitacion | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = createAdminClient();
  const { data: inv } = await db
    .from("invitaciones")
    .select("user_id, expira_at, usada_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!inv || inv.usada_at || new Date(inv.expira_at) <= new Date()) return null;
  const [{ data: u }, { data: perfil }, { data: privado }] = await Promise.all([
    db.auth.admin.getUserById(inv.user_id),
    db.from("perfiles").select("nombre, rol").eq("user_id", inv.user_id).maybeSingle(),
    db.from("perfil_privado").select("dni, telefono").eq("user_id", inv.user_id).maybeSingle(),
  ]);
  const activa = !u.user?.banned_until || new Date(u.user.banned_until) <= new Date();
  if (!u.user?.email || !activa || !perfil) return null;
  return {
    userId: inv.user_id,
    email: u.user.email,
    nombre: perfil.nombre ?? "",
    rol: perfil.rol,
    dni: privado?.dni ?? "",
    telefono: privado?.telefono ?? "",
    vence: inv.expira_at,
  };
}
