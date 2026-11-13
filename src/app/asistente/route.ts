import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { preguntar } from "@/lib/asistente/agente";
import { createClient, requireSesion } from "@/lib/supabase/server";

// Pregunta al asistente (fase 1: Tesorería, solo lectura y filtros). Las herramientas leen con la sesión de quien
// pregunta; la clave de la API de Claude solo vive en el servidor (ANTHROPIC_API_KEY).
const Pedido = z.object({
  texto: z.string().trim().max(2000),
  historial: z
    .array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().max(4000) }))
    .max(20)
    .default([]),
  imagenes: z
    .array(z.object({ media_type: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(1_500_000).regex(/^[A-Za-z0-9+/=]+$/) }))
    .max(3)
    .default([]),
  pantalla: z.string().max(300).default("/tesoreria"),
});

// Tope por persona (en la memoria de cada instancia del servidor): una pregunta cuesta, y un bucle no debe gastar sin fin.
const POR_MINUTO = 10;
const uso = new Map<string, number[]>();
function permitido(userId: string): boolean {
  const ahora = Date.now();
  const recientes = (uso.get(userId) ?? []).filter((t) => ahora - t < 60_000);
  if (recientes.length >= POR_MINUTO) return false;
  uso.set(userId, [...recientes, ahora]);
  return true;
}

export async function POST(req: Request) {
  const sesion = await requireSesion(["TESORERIA"]);
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "El asistente no está configurado" }, { status: 503 });
  const p = Pedido.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Pedido inválido" }, { status: 400 });
  if (!p.data.texto && !p.data.imagenes.length) return Response.json({ error: "Escribe o adjunta algo" }, { status: 400 });
  if (!permitido(sesion.userId)) return Response.json({ error: "Muchas preguntas seguidas: espera un minuto" }, { status: 429 });
  try {
    const r = await preguntar(await createClient(), p.data);
    return Response.json(r);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "El asistente está ocupado: prueba en un momento" }, { status: 429 });
    if (e instanceof Anthropic.APIError) {
      console.error("asistente", e.status, e.message);
      return Response.json({ error: "El asistente no respondió" }, { status: 502 });
    }
    throw e;
  }
}
