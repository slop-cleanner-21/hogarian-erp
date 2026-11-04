"use server";

import { redirect } from "next/navigation";
import { registrarEvento } from "@/lib/auditoria";
import { createClient } from "@/lib/supabase/server";
import { MIN_CONTRASENA } from "@/lib/usuarios";

// Cada inicio de sesión (y cada intento fallido), cierre y cambio de contraseña queda en la auditoría, con la
// IP y el dispositivo.

export async function login(_: string | null, formData: FormData): Promise<string | null> {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
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
