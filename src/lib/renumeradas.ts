import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Una orden que no está: si cambió de N° (`ordenes_renumeradas`), redirige al N° nuevo en la misma pantalla; si no, 404.
 * Así un link viejo (compartido por WhatsApp o de un aviso al celular) sigue llevando a la orden.
 */
export async function aLaOrdenRenumerada(base: string, obraId: number, numero: string, query = ""): Promise<never> {
  const supabase = await createClient();
  const { data } = await supabase.from("ordenes_renumeradas").select("nuevo").eq("obra_id", obraId).eq("anterior", numero).maybeSingle();
  if (data?.nuevo) redirect(`${base}/${obraId}/${encodeURIComponent(data.nuevo)}${query}`);
  notFound();
}
