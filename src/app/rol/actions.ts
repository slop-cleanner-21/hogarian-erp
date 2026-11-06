"use server";

import { redirect } from "next/navigation";
import { HOME_BY_ROL } from "@/lib/nav";
import { rutaInterna } from "@/lib/ruta-interna";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { Rol } from "@/lib/types";

/**
 * Pasa a otro de sus roles (lo revisa la base) y renueva la sesión para que las pantallas lo tomen ya. Abre `volver` o
 * el inicio de ese rol. Devuelve el error, si lo hay.
 */
export async function cambiarRol(rol: string, volver?: string): Promise<string | null> {
  await requireSesion();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cambiar_rol", { p_rol: rol });
  if (error) return error.message;
  const { error: e2 } = await supabase.auth.refreshSession();
  if (e2) return e2.message;
  const ruta = volver ? rutaInterna(volver) : "/";
  redirect(ruta === "/" ? (HOME_BY_ROL[rol as Rol] ?? "/") : ruta);
}
