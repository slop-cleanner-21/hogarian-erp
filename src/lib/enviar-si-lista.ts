import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { enviarAvisosPendientes } from "@/lib/push";
import type { createClient } from "@/lib/supabase/server";

/**
 * Prod 1: si la orden quedó facturada con lo que le toca (guía o contrato firmado), va sola a Tesorería.
 * Se llama tras cada acción de Logística que puede completarla. Devuelve el error, si lo hubo.
 */
export async function enviarSiLista(supabase: Awaited<ReturnType<typeof createClient>>, obraId: number, numero: string) {
  const { data, error } = await supabase.rpc("enviar_si_lista", { p_obra_id: obraId, p_numero: numero });
  if (error) return error.message;
  if (data) {
    after(enviarAvisosPendientes);
    revalidatePath("/logistica");
  }
  return null;
}
