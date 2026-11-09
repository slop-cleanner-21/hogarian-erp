"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Result } from "@/app/logistica/actions";
import { createClient, requireSesion } from "@/lib/supabase/server";

const Entrega = z.object({
  obraId: z.number().int().positive(),
  numero: z.string().min(1),
  ocItemId: z.number().int().positive("Elige el ítem"),
  cantidad: z.number().positive("Ingresa la cantidad que llegó"),
  // Logística puede registrar sin foto; el residente, no (lo exige la base).
  fotos: z.array(z.string().min(1)),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  precision: z.number().nullable(),
  capturado: z.string().nullable(),
  observacion: z.string().trim().min(1, "Escribe la observación").nullable(),
});

/** Registra lo que llegó de una línea de la orden, con sus fotos ya subidas. */
export async function registrarEntrega(input: z.input<typeof Entrega>): Promise<Result<number>> {
  const p = Entrega.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await requireSesion(["LOGISTICA", "RESIDENTE"]);
  const supabase = await createClient();
  const d = p.data;
  const { data, error } = await supabase.rpc("registrar_entrega", {
    p_oc_item_id: d.ocItemId,
    p_cantidad: d.cantidad,
    p_fotos: d.fotos,
    p_lat: d.lat as number,
    p_lng: d.lng as number,
    p_precision: d.precision as number,
    p_capturado: d.capturado as string,
    p_observacion: d.observacion as string,
  });
  if (error) return { ok: false, error: error.message };
  const numero = encodeURIComponent(d.numero);
  revalidatePath(`/logistica/ordenes/${d.obraId}/${numero}`);
  revalidatePath(`/residente/${d.obraId}/${numero}`);
  revalidatePath("/logistica");
  return { ok: true, data: Number(data) };
}
