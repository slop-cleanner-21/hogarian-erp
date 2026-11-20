"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { Result } from "@/app/logistica/actions";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient, requireSesion } from "@/lib/supabase/server";

// Solicitudes de adicionales (migración prod1_solicitudes_adicional): Logística las pide y Gerencia las aprueba o rechaza.
// Las reglas están en la base (pedir_adicional, resolver_adicionales); aquí solo se valida la forma.

const Linea = z.object({
  etapa: z.string().min(1),
  item_id: z.number().int().positive(),
  cantidad: z.number().positive(),
  pu: z.number().min(0),
});
const Pedido = z.object({
  obraId: z.number().int().positive("Elige la obra"),
  partidas: z.array(Linea).min(1, "Agrega al menos una partida"),
  motivo: z.string().trim().min(1, "Escribe el motivo").max(1000),
});

/** Logística pide un adicional; le llega a Gerencia para aprobarlo. */
export async function pedirAdicional(input: z.input<typeof Pedido>): Promise<Result<number>> {
  const p = Pedido.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await requireSesion(["LOGISTICA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pedir_adicional", { p_obra_id: p.data.obraId, p_partidas: p.data.partidas, p_motivo: p.data.motivo });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath("/logistica/adicionales");
  revalidatePath("/gerencia/adicionales");
  return { ok: true, data: Number(data) };
}

const Resolucion = z.object({
  ids: z.array(z.number().int().positive()).min(1, "Elige al menos una solicitud"),
  aprobar: z.boolean(),
  respuesta: z.string().trim().max(1000).nullable(),
});

export type ResultadoResolucion = { hechas: number; errores: { id: number; error: string }[] };

/** Gerencia aprueba (cada una se vuelve el siguiente «Adicional N» de su obra) o rechaza, con su motivo, una o varias. */
export async function resolverAdicionales(input: z.input<typeof Resolucion>): Promise<Result<ResultadoResolucion>> {
  const p = Resolucion.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!p.data.aprobar && !p.data.respuesta) return { ok: false, error: "Escribe el motivo del rechazo" };
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolver_adicionales", { p_ids: p.data.ids, p_aprobar: p.data.aprobar, p_respuesta: p.data.respuesta ?? "" });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath("/gerencia/adicionales");
  revalidatePath("/logistica/adicionales");
  return { ok: true, data: data as unknown as ResultadoResolucion };
}
