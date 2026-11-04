"use server";

import { redirect } from "next/navigation";
import { origen, registrarEvento } from "@/lib/auditoria";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MIN_CONTRASENA } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.

// Contra la fuerza bruta: intentos fallidos en los últimos 15 minutos, por cuenta y por IP (la del celular, no
// la del servidor). Se corta antes de llamar a Supabase: así un ataque tampoco agota su límite, que ve la IP
// del servidor y es el mismo para todos.
const VENTANA_MIN = 15;
const MAX_POR_CUENTA = 10;
const MAX_POR_IP = 30;
const BLOQUEADO = `Demasiados intentos. Vuelve a intentarlo en ${VENTANA_MIN} minutos.`;

async function demasiadosIntentos(email: string): Promise<boolean> {
  const { ip } = await origen();
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const db = createAdminClient();
  const fallidos = (campo: "email" | "ip", valor: string) =>
    db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("tabla", "sesion")
      .eq("accion", "LOGIN_FALLIDO")
      .gte("created_at", desde)
      .eq(`detalle->>${campo}`, valor);
  // En local todo llega de la misma máquina (::1): ahí solo cuenta por cuenta.
  const porIpCuenta = ip && !["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip);
  const [cuenta, porIp] = await Promise.all([fallidos("email", email), porIpCuenta ? fallidos("ip", ip) : Promise.resolve({ count: 0 })]);
  return (cuenta.count ?? 0) >= MAX_POR_CUENTA || (porIp.count ?? 0) >= MAX_POR_IP;
}

export async function login(_: string | null, formData: FormData): Promise<string | null> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  // Bloqueado: no se registra cada intento (serían escrituras anónimas sin tope); ya quedaron los que llevaron aquí.
  if (await demasiadosIntentos(email)) return BLOQUEADO;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(formData.get("password") ?? ""),
  });
  if (error) {
    await registrarEvento({ tabla: "sesion", accion: "LOGIN_FALLIDO", detalle: { email, motivo: error.code ?? error.message } });
    return "Correo o contraseña incorrectos";
  }
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: data.user.id, actor: data.user.id, detalle: { email } });
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub ?? null;
  await supabase.auth.signOut();
  if (id) await registrarEvento({ tabla: "sesion", accion: "LOGOUT", registro: id, actor: id, detalle: { email: data?.claims?.email ?? null } });
  redirect("/login");
}

/** El usuario cambia su propia contraseña (p. ej. la temporal que le dio el Admin). */
export async function cambiarMiContrasena(nueva: string): Promise<string | null> {
  if (nueva.length < MIN_CONTRASENA) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres`;
  if (nueva.length > 72) return "La contraseña es demasiado larga";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password: nueva });
  if (!error) {
    await registrarEvento({ tabla: "sesion", accion: "CAMBIO_CONTRASENA", registro: data.user.id, actor: data.user.id });
    return null;
  }
  if (error.code === "same_password") return "Es la misma contraseña que ya tienes";
  return error.message;
}
