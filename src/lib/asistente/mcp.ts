// Servidor MCP del asistente de Tesorería (fase 1: solo lectura y filtros). Cada pedido arma uno nuevo con el cliente de
// Supabase de quien pregunta: las herramientas leen con su sesión, así que la base (RLS) le da solo lo que él ve en
// pantalla. Nada escribe: solo `select` (ni RPC, que algunas registran o recalculan). Las herramientas de filtro no
// navegan: devuelven el enlace, que arma el servidor desde ids validados (src/lib/asistente/urls.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { desdeFecha, RANGOS_MONTO } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import { normalizarItem } from "@/lib/parecidos";
import type { createClient } from "@/lib/supabase/server";
import { FiltrosPagos, FiltrosPresupuesto, urlPagos, urlPresupuesto } from "./urls";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Resultado de una herramienta: JSON en texto (lo que lee el modelo). */
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fallo = (mensaje: string) => ({ content: [{ type: "text" as const, text: mensaje }], isError: true });

/** ¿Todas las palabras buscadas están en el nombre (como palabra o comienzo de palabra)? Sin tildes ni mayúsculas. */
export function coincide(nombre: string, texto: string): boolean {
  const n = normalizarItem(nombre).split(" ");
  const buscadas = normalizarItem(texto).split(" ").filter(Boolean);
  return buscadas.length > 0 && buscadas.every((b) => n.some((p) => p.startsWith(b)));
}

const ETAPAS = z.array(z.string().trim().min(1).max(20)).max(30);
const LIMITE = z.number().int().min(1).max(50).default(20);

export function crearServidorMcp(db: Db): McpServer {
  const server = new McpServer({ name: "hogarian-tesoreria", version: "0.1.0" });

  server.registerTool(
    "listar_empresas",
    { description: "Empresas del grupo (id y nombre). Tesorería trabaja por empresa." },
    async () => {
      const { data, error } = await db.from("empresas").select("id, nombre").order("nombre");
      return error ? fallo(error.message) : json(data);
    },
  );

  server.registerTool(
    "buscar_obras",
    {
      description:
        "Obras por nombre (sin importar tildes ni mayúsculas; vacío = todas), con su empresa. Úsala para pasar del nombre que dice " +
        "el usuario (p. ej. «adolfo king») al id de la obra. Ojo: varias obras se llaman como personas.",
      inputSchema: { texto: z.string().trim().max(80).optional() },
    },
    async ({ texto }) => {
      const { data, error } = await db.from("obras").select("id, nombre, empresa_id, estado, empresas(nombre)").order("nombre");
      if (error) return fallo(error.message);
      const filas = data
        .filter((o) => !texto || coincide(o.nombre, texto))
        .map((o) => ({ id: o.id, nombre: o.nombre, estado: o.estado, empresa_id: o.empresa_id, empresa: (o.empresas as unknown as { nombre: string } | null)?.nombre ?? null }));
      return json(filas);
    },
  );

  server.registerTool(
    "buscar_proveedores",
    {
      description: "Proveedores por razón social o RUC (sin importar tildes ni mayúsculas). Hasta 10, los que mejor coinciden.",
      inputSchema: { texto: z.string().trim().min(2).max(80) },
    },
    async ({ texto }) => {
      const filas = await todas((a, b) => db.from("proveedores").select("id, razon_social, ruc_o_cod").order("id").range(a, b));
      const digitos = texto.replace(/\D/g, "");
      const hallados = filas.filter((p) => coincide(p.razon_social, texto) || (digitos.length >= 6 && p.ruc_o_cod.includes(digitos)));
      return json(hallados.slice(0, 10).map((p) => ({ id: p.id, razon_social: p.razon_social, ruc: p.ruc_o_cod })));
    },
  );

  server.registerTool(
    "etapas_de_obra",
    {
      description: "Las etapas de una obra (códigos como L1A, L2B, ACB 1), en su orden. Para filtrar por etapa usa estos códigos tal cual.",
      inputSchema: { obra_id: z.number().int().positive() },
    },
    async ({ obra_id }) => {
      const { data, error } = await db.from("obra_etapas").select("etapa, orden").eq("obra_id", obra_id).order("orden");
      if (error) return fallo(error.message);
      if (data.length) return json(data.map((e) => e.etapa));
      // Sin orden definido: las etapas de sus partidas.
      const partidas = await todas((a, b) => db.from("partidas").select("etapa").eq("obra_id", obra_id).order("id").range(a, b));
      return json([...new Set(partidas.map((p) => p.etapa))].sort());
    },
  );

  server.registerTool(
    "consultar_documentos",
    {
      description:
        "Lee las OC u OS de la lista de Pagos con los mismos filtros que la pantalla y devuelve cuántas son, sus sumas y las " +
        "primeras filas. estado: pendiente (por pagar), pagado o rechazos. Montos en soles.",
      inputSchema: {
        empresa_id: z.number().int().positive().optional(),
        obra_id: z.number().int().positive().optional(),
        doc: z.enum(["OC", "OS"]).default("OC"),
        estado: z.enum(["pendiente", "pagado", "rechazos"]).default("pendiente"),
        proveedor_id: z.number().int().positive().optional(),
        etapas: ETAPAS.optional(),
        fecha: z.string().max(30).optional(),
        monto: z.enum(["bajo", "medio", "alto"]).optional(),
        limite: LIMITE,
      },
    },
    async (f) => {
      const desde = desdeFecha(f.fecha ?? null);
      if (f.estado === "rechazos") {
        const filas = await todas((a, b) => {
          let q = db.from("v_rechazos").select("doc, obra_id, numero, obra, proveedor, ruc, motivo, created_at").eq("doc", f.doc);
          if (f.empresa_id) q = q.eq("empresa_id", f.empresa_id);
          if (f.obra_id) q = q.eq("obra_id", f.obra_id);
          if (desde) q = q.gte("created_at", desde[0]).lt("created_at", desde[1]);
          return q.order("created_at", { ascending: false }).order("id").range(a, b);
        });
        return json({ cantidad: filas.length, filas: filas.slice(0, f.limite) });
      }
      const pagado = f.estado === "pagado";
      const columnaMonto = pagado ? "pagado" : "saldo";
      const filas = await todas((a, b) => {
        let q = db
          .from("v_por_pagar")
          .select("doc, obra_id, numero, obra, empresa, proveedor, ruc, fecha, total, pagado, saldo, etapas")
          .eq("estado", pagado ? "PAGADO" : "PENDIENTE")
          .eq("doc", f.doc);
        if (f.empresa_id) q = q.eq("empresa_id", f.empresa_id);
        if (f.obra_id) q = q.eq("obra_id", f.obra_id);
        if (f.proveedor_id) q = q.eq("proveedor_id", f.proveedor_id);
        if (f.etapas?.length) q = q.overlaps("etapas", f.etapas);
        if (desde) q = q.gte("fecha", desde[0]).lt("fecha", desde[1]);
        const rango = RANGOS_MONTO[f.monto ?? ""];
        if (rango) {
          q = q.gte(columnaMonto, rango[0]);
          if (rango[1] != null) q = q.lt(columnaMonto, rango[1]);
        }
        return q.order("fecha", { ascending: !pagado }).order("numero").order("obra_id").range(a, b);
      });
      const suma = (k: "total" | "pagado" | "saldo") => Math.round(filas.reduce((s, r) => s + Number(r[k] ?? 0), 0) * 100) / 100;
      return json({ cantidad: filas.length, total: suma("total"), pagado: suma("pagado"), saldo: suma("saldo"), filas: filas.slice(0, f.limite) });
    },
  );

  server.registerTool(
    "detalle_orden",
    {
      description: "Una OC u OS: sus ítems (cantidad, P.U., parcial, etapa), su comprobante (con detracción y retención) y sus pagos.",
      inputSchema: { obra_id: z.number().int().positive(), numero: z.string().trim().min(1).max(20) },
    },
    async ({ obra_id, numero }) => {
      const [cab, lineas] = await Promise.all([
        db
          .from("v_por_pagar")
          .select("doc, obra, empresa, proveedor, ruc, fecha, total, pagado, saldo, estado, n_comprobantes, tiene_contrato, falta_comprobante, falta_guia")
          .eq("obra_id", obra_id)
          .eq("numero", numero)
          .maybeSingle(),
        db
          .from("v_oc_items")
          .select("descripcion, unidad, cantidad, pu_efectivo, parcial, etapa, requerimiento, comprobante_id")
          .eq("obra_id", obra_id)
          .eq("numero_oc", numero)
          .order("id"),
      ]);
      if (cab.error) return fallo(cab.error.message);
      if (!cab.data) return fallo(`No hay una orden ${numero} en esa obra`);
      const compIds = [...new Set((lineas.data ?? []).map((l) => l.comprobante_id).filter((c): c is number => c != null))];
      const [comps, apl] = await Promise.all([
        compIds.length
          ? db.from("comprobantes").select("id, tipo, serie, numero, fecha_emision, total, detraccion, retencion, anulado_at").in("id", compIds)
          : Promise.resolve({ data: [] }),
        db
          .from("pago_aplicaciones")
          .select("monto, pagos(fecha, banco, numero_operacion)")
          .or(`and(obra_id.eq.${obra_id},numero_oc.eq.${numero})${compIds.length ? `,comprobante_id.in.(${compIds.join(",")})` : ""}`),
      ]);
      return json({
        orden: { numero, ...cab.data },
        items: (lineas.data ?? []).map((l) => ({ descripcion: l.descripcion, unidad: l.unidad, cantidad: l.cantidad, pu: l.pu_efectivo, parcial: l.parcial, etapa: l.etapa, requerimiento: l.requerimiento })),
        comprobantes: (comps.data ?? [])
          .filter((c) => !c.anulado_at)
          .map((c) => ({ tipo: c.tipo, serie: c.serie, numero: c.numero, fecha: c.fecha_emision, total: c.total, detraccion: c.detraccion, retencion: c.retencion })),
        pagos: (apl.data ?? []).map((p) => ({ monto: p.monto, ...(p.pagos as unknown as object) })),
      });
    },
  );

  server.registerTool(
    "aplicar_filtros_pagos",
    {
      description:
        "Abre la lista de Pagos con estos filtros (lo que el usuario pide «ver»). Usa ids de las herramientas de búsqueda, nunca " +
        "inventados. Si das la obra y no la empresa, se toma la de la obra. etapas: códigos de etapas_de_obra. fecha: 7d, 30d, " +
        "mes, mesant o AAAA-MM-DD_AAAA-MM-DD. monto: bajo (< 1,000), medio (1,000 a 10,000), alto (> 10,000). Sin obra ni " +
        "empresa, se abre con todas las empresas.",
      inputSchema: {
        empresa_id: z.number().int().positive().optional(),
        todas_las_empresas: z.boolean().optional(),
        obra_id: z.number().int().positive().optional(),
        doc: z.enum(["OC", "OS"]).default("OC"),
        estado: z.enum(["pendiente", "pagado", "rechazos"]).default("pendiente"),
        proveedor_id: z.number().int().positive().optional(),
        etapas: ETAPAS.optional(),
        fecha: z.string().max(30).optional(),
        monto: z.enum(["bajo", "medio", "alto"]).optional(),
        orden: FiltrosPagos.shape.orden,
      },
    },
    async ({ todas_las_empresas, ...f }) => {
      let empresa: number | "todas" | undefined = todas_las_empresas ? "todas" : f.empresa_id;
      if (f.obra_id) {
        const { data: obra } = await db.from("obras").select("empresa_id").eq("id", f.obra_id).maybeSingle();
        if (!obra) return fallo("Esa obra no existe");
        if (empresa !== undefined && empresa !== "todas" && empresa !== obra.empresa_id) return fallo("Esa obra no es de esa empresa");
        if (empresa === undefined) empresa = obra.empresa_id;
      }
      const p = FiltrosPagos.safeParse({ ...f, empresa_id: empresa ?? "todas" });
      if (!p.success) return fallo(p.error.issues[0].message);
      return json({ navegar: urlPagos(p.data) });
    },
  );

  server.registerTool(
    "aplicar_filtros_presupuesto",
    {
      description:
        "Abre el Presupuesto de una obra (lo presupuestado y lo pagado por partida). rubro: MATERIAL, MANO OBRA o SUBCONTRATO. " +
        "pago: porpagar, parcial, completo o sinpagar. busqueda: un ítem (p. ej. «cemento»).",
      inputSchema: {
        obra_id: z.number().int().positive(),
        rubro: z.enum(["MATERIAL", "MANO OBRA", "SUBCONTRATO"]).default("MATERIAL"),
        etapas: ETAPAS.optional(),
        pago: z.enum(["porpagar", "parcial", "completo", "sinpagar"]).optional(),
        busqueda: z.string().trim().max(60).optional(),
      },
    },
    async (f) => {
      const { data: obra } = await db.from("obras").select("empresa_id").eq("id", f.obra_id).maybeSingle();
      if (!obra) return fallo("Esa obra no existe");
      const p = FiltrosPresupuesto.safeParse({ ...f, empresa_id: obra.empresa_id });
      if (!p.success) return fallo(p.error.issues[0].message);
      return json({ navegar: urlPresupuesto(p.data) });
    },
  );

  return server;
}
