"use server";

import { representanteContratos } from "@/lib/representante";
import { createClient, requireSesionVigente } from "@/lib/supabase/server";

/**
 * La firma de quien firma por la empresa (data URL), solo al armar el PDF del contrato de una OS. Antes viajaba
 * en cada vista de la orden aunque no se generara el contrato.
 */
export async function firmaContrato(obraId: number, numero: string): Promise<string | null> {
  await requireSesionVigente(["LOGISTICA"]);
  const supabase = await createClient();
  const { data: o } = await supabase.from("v_ordenes").select("empresa_id, tipo").eq("obra_id", obraId).eq("numero", numero).maybeSingle();
  if (!o || o.tipo !== "OS") return null;
  const { representante } = await representanteContratos(o.empresa_id ?? null);
  return representante?.firma ?? null;
}
