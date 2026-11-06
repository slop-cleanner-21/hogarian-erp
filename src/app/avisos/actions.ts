"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eventosDe, porDefecto } from "@/lib/avisos";
import { createClient, misRoles, requireSesion } from "@/lib/supabase/server";

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

/**
 * Qué avisos recibe (de los que su rol puede elegir) y cuáles también al celular. Se guarda solo lo que cambió del
 * defecto (los de su rol llegan; los de los demás, no).
 */
export async function guardarPreferencia(tipo: string, avisar: boolean, celular: boolean): Promise<string | null> {
  const { userId } = await requireSesion();
  const evento = eventosDe(await misRoles()).find((e) => e.tipo === tipo);
  if (!evento) return "Ese aviso no es para tu rol";
  const elegido = { avisar: !!avisar, celular: !!avisar && !!celular };
  const defecto = porDefecto(evento.propio);
  const supabase = await createClient();
  const { error } =
    elegido.avisar === defecto.avisar && elegido.celular === defecto.celular
      ? await supabase.from("aviso_preferencias").delete().eq("user_id", userId).eq("tipo", tipo)
      : await supabase.from("aviso_preferencias").upsert({ user_id: userId, tipo, ...elegido }, { onConflict: "user_id,tipo" });
  revalidatePath("/avisos");
  return error ? error.message : null;
}
