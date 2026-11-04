"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Result } from "@/app/logistica/actions";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient, requireSesion } from "@/lib/supabase/server";

/** Operaciones da por recibida una orden aunque falte una parte; lo que no llegó vuelve al saldo. */
export async function cerrarEntrega(obraId: number, numero: string, motivo: string): Promise<Result> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cerrar_entrega", { p_obra_id: obraId, p_numero: numero, p_motivo: motivo });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath(`/consulta/orden/${obraId}/${encodeURIComponent(numero)}`);
  return { ok: true, data: undefined };
}
