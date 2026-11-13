// El asistente: Claude con las herramientas del servidor MCP de Tesorería, conectado en el mismo proceso (memoria, sin
// red). El conector MCP de la API no sirve aquí: necesita una URL pública y no llevaría la sesión de quien pregunta.
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { createClient } from "@/lib/supabase/server";
import { crearServidorMcp } from "./mcp";

type Db = Awaited<ReturnType<typeof createClient>>;

export const MODELO = "claude-opus-5-5";
const MAX_VUELTAS = 8;

const SISTEMA = `Eres el asistente de Tesorería del ERP de Hogarian, una constructora peruana. Respondes en español, breve y claro, para alguien que trabaja desde el celular. Texto plano: sin Markdown (ni asteriscos, ni #, ni tablas); para listas, una línea por elemento.

En esta fase solo lees y filtras: no pagas, no rechazas, no cambias nada. Si te piden algo así, di que todavía no puedes y que lo hagan en la pantalla.

Cómo trabajar:
- Los nombres que dice el usuario (obras, proveedores, etapas) los resuelves con las herramientas de búsqueda; nunca inventes un id. Muchas obras se llaman como personas («Adolfo King» es una obra): busca en obras y en proveedores cuando no esté claro, y di cuál tomaste.
- Si piden «ver», «mostrar», «filtrar» o «abrir» algo, usa aplicar_filtros_pagos o aplicar_filtros_presupuesto: la app abre la pantalla con esos filtros. Di en una línea qué quedó filtrado (pestaña OC u OS, por pagar / pagado / rechazos, obra, etapas…).
- Si preguntan cuánto, cuántas o qué, consulta y responde con el dato. Montos con «S/» y separador de miles (S/ 1,234.50).
- Si algo es ambiguo (dos obras o proveedores posibles), pregunta en una línea antes de filtrar.
- Una foto puede ser una factura, un voucher o una captura: lee sus datos (proveedor, RUC, serie y número, monto) y búscalos.
- Las etapas se escriben como en la obra (L1A, L2B, ACB 1): tómalas de etapas_de_obra.
- No muestres ids internos ni cuentas bancarias.`;

export type Turno = { rol: "usuario" | "asistente"; texto: string };
export type Imagen = { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string };
export type Respuesta = { texto: string; navegar: string | null };

/** Una pregunta al asistente, con las herramientas leyendo como `db` (la sesión de quien pregunta). */
export async function preguntar(
  db: Db,
  { historial, texto, imagenes, pantalla }: { historial: Turno[]; texto: string; imagenes: Imagen[]; pantalla: string },
): Promise<Respuesta> {
  const [lado, ladoServidor] = InMemoryTransport.createLinkedPair();
  const servidor = crearServidorMcp(db);
  const mcp = new Client({ name: "erp-tesoreria", version: "0.1.0" });
  await Promise.all([servidor.connect(ladoServidor), mcp.connect(lado)]);
  try {
    const { tools } = await mcp.listTools();
    const herramientas: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));

    const hoy = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const mensajes: Anthropic.Beta.BetaMessageParam[] = [
      ...historial.map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.rol === "usuario" ? "user" : "assistant", content: t.texto })),
      {
        role: "user",
        content: [
          ...imagenes.map((i): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
          { type: "text", text: `(Hoy es ${hoy}. Pantalla actual: ${pantalla})\n\n${texto || "Revisa la imagen."}` },
        ],
      },
    ];

    const client = new Anthropic();
    let navegar: string | null = null;
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const r = await client.beta.messages.create({
        model: MODELO,
        max_tokens: 8000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
        tools: herramientas,
        messages: mensajes,
      });

      if (r.stop_reason === "refusal") return { texto: "No puedo ayudar con eso.", navegar };
      const usos = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || usos.length === 0) {
        const texto = r.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { texto: texto || (navegar ? "Listo." : "No encontré una respuesta."), navegar };
      }

      mensajes.push({ role: "assistant", content: r.content });
      const resultados = await Promise.all(
        usos.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const res = await mcp.callTool({ name: u.name, arguments: u.input as Record<string, unknown> });
          const texto = (res.content as { type: string; text?: string }[])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          if (!res.isError && u.name.startsWith("aplicar_filtros_")) {
            try {
              navegar = (JSON.parse(texto) as { navegar?: string }).navegar ?? navegar;
            } catch {}
          }
          return { type: "tool_result", tool_use_id: u.id, content: texto, is_error: res.isError === true };
        }),
      );
      mensajes.push({ role: "user", content: resultados });
    }
    return { texto: "Me tomó demasiados pasos. Prueba con una pregunta más concreta.", navegar };
  } finally {
    await Promise.allSettled([mcp.close(), servidor.close()]);
  }
}
