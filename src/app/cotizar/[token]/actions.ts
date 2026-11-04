"use server";

import { after } from "next/server";
import { z } from "zod";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  token: z.string().uuid(),
  precios: z.array(z.object({ item_id: z.number().int(), pu: z.number().positive() })).min(1),
});

// Público: la autorización la da el token (RPC security definer: link vigente y cotización "enviada").
export async function enviarCotizacion(input: z.input<typeof Input>): Promise<string | null> {
  const p = Input.safeParse(input);
  if (!p.success) return "Completa todos los precios";
  const supabase = await createClient();
  const { error } = await supabase.rpc("enviar_cotizacion", {
    p_token: p.data.token,
    p_precios: p.data.precios,
  });
  if (error) return error.message;
  after(enviarAvisosPendientes); // aviso a Logística: cotización recibida
  return null;
}
