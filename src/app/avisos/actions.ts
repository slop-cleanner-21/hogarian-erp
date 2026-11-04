"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, requireSesion } from "@/lib/supabase/server";

const Suscripcion = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Guarda la suscripción push de este dispositivo para el usuario actual. */
export async function guardarSuscripcion(input: unknown): Promise<string | null> {
  const p = Suscripcion.safeParse(input);
  if (!p.success) return "Suscripción inválida";
  const { userId } = await requireSesion();
  const supabase = await createClient();
  // Un mismo dispositivo puede haber estado suscrito con otro usuario: se reasigna.
  await supabase.from("push_suscripciones").delete().eq("endpoint", p.data.endpoint);
  const { error } = await supabase.from("push_suscripciones").insert({
    user_id: userId,
    endpoint: p.data.endpoint,
    p256dh: p.data.keys.p256dh,
    auth: p.data.keys.auth,
  });
  return error ? error.message : null;
}

export async function quitarSuscripcion(endpoint: string): Promise<void> {
  await requireSesion();
  const supabase = await createClient();
  await supabase.from("push_suscripciones").delete().eq("endpoint", endpoint);
}

/** Marca como leídos todos los avisos del usuario. */
export async function marcarLeidas(): Promise<void> {
  const { userId } = await requireSesion();
  const supabase = await createClient();
  await supabase.from("notificaciones").update({ leida_at: new Date().toISOString() }).eq("user_id", userId).is("leida_at", null);
  revalidatePath("/avisos");
}

/** Borra avisos del usuario: los indicados o, sin ids, todos. */
export async function borrarAvisos(ids?: number[]): Promise<string | null> {
  const { userId } = await requireSesion();
  const supabase = await createClient();
  let q = supabase.from("notificaciones").delete().eq("user_id", userId);
  if (ids) q = q.in("id", ids);
  const { error } = await q;
  revalidatePath("/avisos");
  return error ? error.message : null;
}
