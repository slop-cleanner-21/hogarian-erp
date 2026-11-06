"use server";

import { z } from "zod";
import { createClient, requireSesion } from "@/lib/supabase/server";

const Sugerencia = z.object({
  tipo: z.enum(["ERROR", "MEJORA", "DISENO"]),
  texto: z.string().trim().min(3, "Cuéntanos qué pasó").max(2000, "Hasta 2,000 caracteres"),
  pantalla: z.string().max(200),
  ruta: z.string().max(500),
  capturas: z.array(z.string().max(200)).max(5, "Hasta 5 capturas"),
});

/** Le llega al Admin (Admin › Sugerencias), con la pantalla y las capturas. Devuelve el error, si lo hay. */
export async function enviarSugerencia(input: z.input<typeof Sugerencia>): Promise<string | null> {
  const p = Sugerencia.safeParse(input);
  if (!p.success) return p.error.issues[0].message;
  await requireSesion();
  const supabase = await createClient();
  const { error } = await supabase.rpc("enviar_sugerencia", {
    p_tipo: p.data.tipo,
    p_texto: p.data.texto,
    p_pantalla: p.data.pantalla,
    p_ruta: p.data.ruta,
    p_capturas: p.data.capturas,
  });
  return error ? error.message : null;
}
