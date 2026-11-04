import { after } from "next/server";
import { z } from "zod";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

// El proveedor envía su cotización. Una ruta (no una server action): sin la contraseña de la demo, el proxy no
// deja pasar ninguna server action (el link es lo único público, y con una server action en esa ruta se podía
// llamar cualquier otra). La autorización la da el token (RPC security definer: link vigente y cotizando).

const Precios = z.object({
  precios: z.array(z.object({ item_id: z.number().int(), pu: z.number().positive().finite().lt(100_000_000) })).min(1).max(500),
});

const responder = (error: string | null, status = error ? 400 : 200) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: Request, { params }: RouteContext<"/cotizar/[token]/enviar">) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return responder("Este link ya no está disponible", 404);
  const p = Precios.safeParse(await req.json().catch(() => null));
  if (!p.success) return responder("Completa todos los precios");
  const supabase = await createClient();
  const { error } = await supabase.rpc("enviar_cotizacion", { p_token: token, p_precios: p.data.precios });
  if (error) {
    // Los mensajes de la función (link vencido, ya enviada, precio inválido) se muestran; un error interno, no.
    return responder(error.code === "P0001" || error.code === "P0429" ? error.message : "No se pudo enviar la cotización");
  }
  after(enviarAvisosPendientes); // aviso a Logística: cotización recibida
  return responder(null);
}
