// Servidor MCP del asistente de Tesorería (fase 1: solo lectura y filtros). Cada pedido arma uno nuevo con el cliente de
// Supabase de quien pregunta: las herramientas leen con su sesión, así que la base (RLS) le da solo lo que él ve en
// pantalla. Nada escribe: solo `select` (ni RPC, que algunas registran o recalculan). Las herramientas de filtro no
// navegan: devuelven el enlace, que arma el servidor desde ids validados (src/lib/asistente/urls.ts).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { acumularPagoPartida, ESTADOS_PAGO } from "@/lib/filtro-pago";
import { desdeFecha, RANGOS_MONTO } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import { normalizarItem } from "@/lib/parecidos";
import type { createClient } from "@/lib/supabase/server";
import { FECHA, FiltrosPagos, FiltrosPresupuesto, urlPagos, urlPresupuesto } from "./urls";

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
/** N° de orden: solo letras, dígitos y guion (va dentro de un filtro de PostgREST). */
const NUMERO = z.string().trim().regex(/^[\w-]{1,20}$/, "N° de orden inválido");
const LIMITE = z.number().int().min(1).max(50).default(20);
const r2 = (n: number) => Math.round(n * 100) / 100;

type FiltrosDocs = {
  empresa_id?: number;
  obra_id?: number;
  doc?: "OC" | "OS";
  estado: "pendiente" | "pagado";
  proveedor_id?: number;
  etapas?: string[];
  fecha?: string;
  monto?: "bajo" | "medio" | "alto";
};

/** Las OC / OS de la lista de Pagos con sus filtros (todas, no una página). Sin `doc`, las dos. */
function leerDocumentos(db: Db, f: FiltrosDocs) {
  const pagado = f.estado === "pagado";
  const columnaMonto = pagado ? "pagado" : "saldo";
  const desde = desdeFecha(f.fecha ?? null);
  return todas((a, b) => {
    let q = db
      .from("v_por_pagar")
      .select("doc, obra_id, numero, obra, empresa, proveedor_id, proveedor, ruc, fecha, total, pagado, saldo, etapas")
      .eq("estado", pagado ? "PAGADO" : "PENDIENTE");
    q = f.doc ? q.eq("doc", f.doc) : q.in("doc", ["OC", "OS"]);
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
}

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
        "Lee las OC u OS de la lista de Pagos con los mismos filtros que la pantalla y devuelve cuántas son, sus sumas (de todas) y " +
        "solo las primeras filas según `orden` (sin_mostrar = las que no vinieron). Para «las más grandes» usa orden monto.desc; " +
        "para «las más antiguas», fecha.asc: no saques un ranking de filas en otro orden. estado: pendiente (por pagar), pagado o " +
        "rechazos. Montos en soles (por pagar: saldo; pagado: lo pagado).",
      inputSchema: {
        empresa_id: z.number().int().positive().optional(),
        obra_id: z.number().int().positive().optional(),
        doc: z.enum(["OC", "OS"]).default("OC"),
        estado: z.enum(["pendiente", "pagado", "rechazos"]).default("pendiente"),
        proveedor_id: z.number().int().positive().optional(),
        etapas: ETAPAS.optional(),
        fecha: FECHA.optional(),
        monto: z.enum(["bajo", "medio", "alto"]).optional(),
        orden: FiltrosPagos.shape.orden,
        limite: LIMITE,
      },
    },
    async (f) => {
      const desde = desdeFecha(f.fecha ?? null);
      if (f.estado === "rechazos") {
        // Los rechazos no traen el id del proveedor: se filtran por su RUC, como la pantalla.
        let ruc: string | null = null;
        if (f.proveedor_id) {
          const { data: prov, error } = await db.from("proveedores").select("ruc_o_cod").eq("id", f.proveedor_id).maybeSingle();
          if (error) return fallo(error.message);
          if (!prov) return fallo("Ese proveedor no existe");
          ruc = prov.ruc_o_cod;
        }
        const filas = await todas((a, b) => {
          let q = db.from("v_rechazos").select("doc, obra_id, numero, obra, proveedor, ruc, motivo, created_at").eq("doc", f.doc);
          if (f.empresa_id) q = q.eq("empresa_id", f.empresa_id);
          if (f.obra_id) q = q.eq("obra_id", f.obra_id);
          if (ruc) q = q.eq("ruc", ruc);
          if (desde) q = q.gte("created_at", desde[0]).lt("created_at", desde[1]);
          return q.order("created_at", { ascending: false }).order("id").range(a, b);
        });
        return json({ cantidad: filas.length, sin_mostrar: Math.max(0, filas.length - f.limite), filas: filas.slice(0, f.limite) });
      }
      const pagado = f.estado === "pagado";
      const columnaMonto = pagado ? "pagado" : "saldo";
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- el id del proveedor no le sirve al modelo
      const filas = (await leerDocumentos(db, { ...f, estado: f.estado })).map(({ proveedor_id, ...r }) => r);
      const suma = (k: "total" | "pagado" | "saldo") => r2(filas.reduce((s, r) => s + Number(r[k] ?? 0), 0));
      if (f.orden) {
        // Sobre todas las filas (ya están en memoria), con desempate por obra y N°: el ranking no depende de cuáles vinieron.
        const [campo, sentido] = f.orden.split(".") as [string, "asc" | "desc"];
        const valor = (r: (typeof filas)[number]): number | string =>
          campo === "monto" ? Number(r[columnaMonto] ?? 0) : campo === "fecha" ? String(r.fecha ?? "") : String(r[campo as "proveedor" | "numero"] ?? "");
        const signo = sentido === "desc" ? -1 : 1;
        filas.sort((a, b) => {
          const va = valor(a);
          const vb = valor(b);
          const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { numeric: true });
          return c * signo || (a.obra_id ?? 0) - (b.obra_id ?? 0) || String(a.numero).localeCompare(String(b.numero), "es", { numeric: true });
        });
      }
      return json({
        cantidad: filas.length,
        total: suma("total"),
        pagado: suma("pagado"),
        saldo: suma("saldo"),
        orden: f.orden ?? (pagado ? "fecha.desc" : "fecha.asc"),
        sin_mostrar: Math.max(0, filas.length - f.limite),
        filas: filas.slice(0, f.limite),
      });
    },
  );

  server.registerTool(
    "detalle_orden",
    {
      description: "Una OC u OS: sus ítems (cantidad, P.U., parcial, etapa), su comprobante (con detracción y retención) y sus pagos.",
      inputSchema: { obra_id: z.number().int().positive(), numero: NUMERO },
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
      if (lineas.error) return fallo(lineas.error.message);
      if (!cab.data) return fallo(`No hay una orden ${numero} en esa obra`);
      const compIds = [...new Set((lineas.data ?? []).map((l) => l.comprobante_id).filter((c): c is number => c != null))];
      const [comps, apl] = await Promise.all([
        compIds.length
          ? db.from("comprobantes").select("id, tipo, serie, numero, fecha_emision, total, detraccion, retencion, anulado_at").in("id", compIds)
          : Promise.resolve({ data: [], error: null }),
        db
          .from("pago_aplicaciones")
          .select("monto, pagos(fecha, banco, numero_operacion)")
          .or(`and(obra_id.eq.${obra_id},numero_oc.eq.${numero})${compIds.length ? `,comprobante_id.in.(${compIds.join(",")})` : ""}`),
      ]);
      // Un error no se lee como «no tiene comprobantes» o «no tiene pagos».
      if (comps.error) return fallo(comps.error.message);
      if (apl.error) return fallo(apl.error.message);
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
    "resumen_por_grupo",
    {
      description:
        "Agrupa las OC y OS de Pagos (por pagar o pagadas, con los mismos filtros que consultar_documentos) y suma en el servidor " +
        "cada grupo: por proveedor, obra, empresa, etapa o mes (de la fecha de la orden). Úsala para «cuánto le debo a cada " +
        "proveedor», «por pagar por obra», «pagado por mes»: nunca sumes a mano filas de consultar_documentos. Sin doc, OC y OS " +
        "juntas. Por etapa, una orden que toca varias etapas reparte su monto entre ellas según lo que pide en cada una (como la " +
        "pantalla), así que cuenta como orden en cada etapa. Grupos de mayor a menor monto (por pagar: saldo; pagadas: pagado).",
      inputSchema: {
        por: z.enum(["proveedor", "obra", "empresa", "etapa", "mes"]),
        estado: z.enum(["pendiente", "pagado"]).default("pendiente"),
        doc: z.enum(["OC", "OS"]).optional(),
        empresa_id: z.number().int().positive().optional(),
        obra_id: z.number().int().positive().optional(),
        proveedor_id: z.number().int().positive().optional(),
        etapas: ETAPAS.optional(),
        fecha: FECHA.optional(),
        monto: z.enum(["bajo", "medio", "alto"]).optional(),
        limite: LIMITE,
      },
    },
    async (f) => {
      const docs = await leerDocumentos(db, f);
      const columna = f.estado === "pagado" ? "pagado" : "saldo";
      const clave = (doc: string | null, obra: number | null, numero: string | null) => `${doc}-${obra}-${numero}`;
      // Por etapa: la parte de cada orden en cada etapa, según el parcial de sus líneas.
      const partes = new Map<string, Map<string, number>>();
      if (f.por === "etapa") {
        const lineas = await todas((a, b) => {
          let q = db.from("v_oc_items_calc").select("tipo, obra_id, numero_oc, etapa, parcial");
          if (f.obra_id) q = q.eq("obra_id", f.obra_id);
          if (f.doc) q = q.eq("tipo", f.doc);
          return q.order("id").range(a, b);
        });
        for (const l of lineas) {
          const k = clave(l.tipo, l.obra_id, l.numero_oc);
          const m = partes.get(k) ?? new Map<string, number>();
          const e = l.etapa ?? "Sin etapa";
          m.set(e, (m.get(e) ?? 0) + (Number(l.parcial) || 0));
          partes.set(k, m);
        }
      }
      const grupos = new Map<string, { grupo: string; ordenes: Set<string>; total: number; pagado: number; saldo: number }>();
      const sumar = (g: string, k: string, d: (typeof docs)[number], parte: number) => {
        const x = grupos.get(g) ?? { grupo: g, ordenes: new Set<string>(), total: 0, pagado: 0, saldo: 0 };
        x.ordenes.add(k);
        x.total += Number(d.total ?? 0) * parte;
        x.pagado += Number(d.pagado ?? 0) * parte;
        x.saldo += Number(d.saldo ?? 0) * parte;
        grupos.set(g, x);
      };
      for (const d of docs) {
        const k = clave(d.doc, d.obra_id, d.numero);
        if (f.por === "etapa") {
          const m = partes.get(k) ?? new Map([["Sin etapa", 0]]);
          const tot = [...m.values()].reduce((a, x) => a + x, 0);
          for (const [e, parcial] of m) sumar(e, k, d, tot > 0 ? parcial / tot : 1 / m.size);
          continue;
        }
        const g =
          f.por === "proveedor"
            ? `${d.proveedor ?? "Sin proveedor"}${d.ruc ? ` (RUC ${d.ruc})` : ""}`
            : f.por === "obra"
              ? (d.obra ?? "Sin obra")
              : f.por === "empresa"
                ? (d.empresa ?? "Sin empresa")
                : (d.fecha ?? "").slice(0, 7) || "Sin fecha";
        sumar(g, k, d, 1);
      }
      const lista = [...grupos.values()]
        .map((g) => ({ grupo: g.grupo, ordenes: g.ordenes.size, total: r2(g.total), pagado: r2(g.pagado), saldo: r2(g.saldo) }))
        .sort((a, b) => b[columna] - a[columna] || a.grupo.localeCompare(b.grupo, "es"));
      const resto = lista.slice(f.limite);
      return json({
        por: f.por,
        estado: f.estado,
        ordenes: docs.length,
        total: r2(docs.reduce((s, d) => s + Number(d.total ?? 0), 0)),
        pagado: r2(docs.reduce((s, d) => s + Number(d.pagado ?? 0), 0)),
        saldo: r2(docs.reduce((s, d) => s + Number(d.saldo ?? 0), 0)),
        grupos: lista.slice(0, f.limite),
        grupos_sin_mostrar: resto.length,
        resto: resto.length ? { [columna]: r2(resto.reduce((s, g) => s + g[columna], 0)) } : null,
      });
    },
  );

  server.registerTool(
    "compras_de_item",
    {
      description:
        "Lo comprado o contratado de un ítem (texto: p. ej. «cemento sol», «fierro 1/2»; sin tildes ni mayúsculas, palabras en " +
        "cualquier orden): por ítem, la cantidad, el monto y el P.U. mínimo, máximo, promedio y el último; por proveedor, el monto; " +
        "y las últimas líneas (orden, obra, proveedor, cantidad, P.U.). Solo órdenes con precio confirmado o más adelante (sin " +
        "las anuladas ni las que están cotizando). fecha: la de la orden.",
      inputSchema: {
        texto: z.string().trim().min(2).max(80),
        empresa_id: z.number().int().positive().optional(),
        obra_id: z.number().int().positive().optional(),
        proveedor_id: z.number().int().positive().optional(),
        doc: z.enum(["OC", "OS"]).optional(),
        etapas: ETAPAS.optional(),
        fecha: FECHA.optional(),
        limite: LIMITE,
      },
    },
    async (f) => {
      const items = (await todas((a, b) => db.from("items").select("id, descripcion, unidad").order("id").range(a, b))).filter((i) =>
        coincide(i.descripcion, f.texto),
      );
      if (!items.length) return fallo(`Ningún ítem coincide con «${f.texto}»`);
      if (items.length > 40)
        return fallo(`Coinciden ${items.length} ítems: pide algo más específico. Por ejemplo: ${items.slice(0, 8).map((i) => i.descripcion).join("; ")}`);
      const obras = await db.from("obras").select("id, nombre, empresa_id");
      if (obras.error) return fallo(obras.error.message);
      const obrasEmpresa = f.empresa_id ? (obras.data ?? []).filter((o) => o.empresa_id === f.empresa_id).map((o) => o.id) : null;
      if (obrasEmpresa && !obrasEmpresa.length) return fallo("Esa empresa no tiene obras");
      const desde = desdeFecha(f.fecha ?? null);
      const lineas = (
        await todas((a, b) => {
          let q = db
            .from("v_oc_items_calc")
            .select("id, tipo, obra_id, numero_oc, fecha, proveedor_id, descripcion, unidad, cantidad, pu_efectivo, parcial, estado, etapa, es_retencion")
            .in(
              "item_id",
              items.map((i) => i.id),
            )
            .not("estado", "in", "(ANULADA,EMITIDA)");
          if (f.obra_id) q = q.eq("obra_id", f.obra_id);
          if (obrasEmpresa) q = q.in("obra_id", obrasEmpresa);
          if (f.proveedor_id) q = q.eq("proveedor_id", f.proveedor_id);
          if (f.doc) q = q.eq("tipo", f.doc);
          if (f.etapas?.length) q = q.in("etapa", f.etapas);
          if (desde) q = q.gte("fecha", desde[0]).lt("fecha", desde[1]);
          return q.order("fecha", { ascending: false }).order("id", { ascending: false }).range(a, b);
        })
      ).filter((l) => !l.es_retencion);
      const provIds = [...new Set(lineas.map((l) => l.proveedor_id).filter((x): x is number => x != null))];
      const provs = provIds.length ? await db.from("proveedores").select("id, razon_social").in("id", provIds) : { data: [], error: null };
      if (provs.error) return fallo(provs.error.message);
      const nombreObra = new Map((obras.data ?? []).map((o) => [o.id, o.nombre]));
      const nombreProv = new Map((provs.data ?? []).map((p) => [p.id, p.razon_social]));
      const obraDe = (id: number | null) => (id == null ? null : (nombreObra.get(id) ?? null));
      const provDe = (id: number | null) => (id == null ? "Sin proveedor" : (nombreProv.get(id) ?? "Sin proveedor"));

      type Ultimo = { fecha: string | null; pu: number; proveedor: string; orden: string; obra: string | null };
      const porItem = new Map<string, { item: string; unidad: string; cantidad: number; monto: number; min: number; max: number; ultimo: Ultimo | null }>();
      const porProv = new Map<string, { proveedor: string; monto: number; lineas: number }>();
      for (const l of lineas) {
        // Vienen de la más reciente a la más antigua: la primera de cada ítem es su último precio.
        const pu = Number(l.pu_efectivo ?? 0);
        const prov = provDe(l.proveedor_id);
        const k = `${l.descripcion}|${l.unidad}`;
        const x = porItem.get(k) ?? { item: l.descripcion ?? "", unidad: l.unidad ?? "", cantidad: 0, monto: 0, min: Infinity, max: -Infinity, ultimo: null };
        x.cantidad += Number(l.cantidad ?? 0);
        x.monto += Number(l.parcial ?? 0);
        x.min = Math.min(x.min, pu);
        x.max = Math.max(x.max, pu);
        x.ultimo ??= { fecha: l.fecha, pu, proveedor: prov, orden: `${l.tipo} ${l.numero_oc}`, obra: obraDe(l.obra_id) };
        porItem.set(k, x);
        const y = porProv.get(prov) ?? { proveedor: prov, monto: 0, lineas: 0 };
        y.monto += Number(l.parcial ?? 0);
        y.lineas += 1;
        porProv.set(prov, y);
      }
      return json({
        items_que_coinciden: items.length,
        lineas: lineas.length,
        monto: r2(lineas.reduce((s, l) => s + Number(l.parcial ?? 0), 0)),
        por_item: [...porItem.values()]
          .sort((a, b) => b.monto - a.monto)
          .map((x) => ({
            item: x.item,
            unidad: x.unidad,
            cantidad: r2(x.cantidad),
            monto: r2(x.monto),
            pu_min: r2(x.min),
            pu_max: r2(x.max),
            pu_promedio: x.cantidad > 0 ? r2(x.monto / x.cantidad) : null,
            ultimo: x.ultimo,
          })),
        por_proveedor: [...porProv.values()].sort((a, b) => b.monto - a.monto).slice(0, 15).map((y) => ({ ...y, monto: r2(y.monto) })),
        ultimas_lineas: lineas.slice(0, f.limite).map((l) => ({
          fecha: l.fecha,
          orden: `${l.tipo} ${l.numero_oc}`,
          obra: obraDe(l.obra_id),
          proveedor: provDe(l.proveedor_id),
          item: l.descripcion,
          etapa: l.etapa,
          cantidad: l.cantidad,
          unidad: l.unidad,
          pu: l.pu_efectivo,
          parcial: l.parcial,
          estado: l.estado,
        })),
        lineas_sin_mostrar: Math.max(0, lineas.length - f.limite),
      });
    },
  );

  server.registerTool(
    "resumen_presupuesto",
    {
      description:
        "Los números del presupuesto de una obra, por etapa, rubro o partida: lo presupuestado, lo comprado (órdenes con precio), " +
        "lo pagado, lo que está en Tesorería por pagar y el excedido (comprado − presupuestado; positivo = se pasó). rubro: " +
        "MATERIAL, MANO OBRA o SUBCONTRATO. busqueda: solo las partidas cuyo ítem coincide (p. ej. «cemento»). orden: el campo " +
        "por el que se ordenan los grupos, de mayor a menor (excedido: primero los que más se pasaron).",
      inputSchema: {
        obra_id: z.number().int().positive(),
        por: z.enum(["etapa", "rubro", "partida"]).default("etapa"),
        rubro: z.enum(["MATERIAL", "MANO OBRA", "SUBCONTRATO"]).optional(),
        etapas: ETAPAS.optional(),
        busqueda: z.string().trim().min(2).max(60).optional(),
        orden: z.enum(["presupuestado", "comprado", "pagado", "por_pagar", "excedido"]).default("presupuestado"),
        limite: LIMITE,
      },
    },
    async (f) => {
      const [partidas, lineasPago] = await Promise.all([
        todas((a, b) => {
          let q = db
            .from("v_avance_partida")
            .select("partida_id, etapa, requerimiento, descripcion, unidad, rubro, presupuestado, pu, parcial, comprado, monto_comprado")
            .eq("obra_id", f.obra_id);
          if (f.rubro) q = q.eq("rubro", f.rubro);
          if (f.etapas?.length) q = q.in("etapa", f.etapas);
          return q.order("partida_id").range(a, b);
        }),
        todas((a, b) =>
          db
            .from("v_oc_items_calc")
            .select("partida_id, cantidad, parcial, estado, es_retencion")
            .eq("obra_id", f.obra_id)
            .in("estado", ESTADOS_PAGO)
            .order("id")
            .range(a, b),
        ),
      ]);
      const pago = acumularPagoPartida(lineasPago);
      const filas = partidas.filter((p) => !f.busqueda || coincide(p.descripcion ?? "", f.busqueda));
      if (!filas.length) return fallo("No hay partidas con esos filtros (¿la obra tiene presupuesto?)");
      type Grupo = {
        grupo: string;
        partidas: number;
        presupuestado: number;
        comprado: number;
        pagado: number;
        por_pagar: number;
        cantidades?: { unidad: string | null; presupuestada: number; comprada: number; pu_presupuesto: number };
      };
      const grupos = new Map<string, Grupo>();
      for (const p of filas) {
        const req = p.requerimiento && p.requerimiento !== "REGULAR" ? ` · ${p.requerimiento}` : "";
        const g = f.por === "etapa" ? (p.etapa ?? "Sin etapa") : f.por === "rubro" ? (p.rubro ?? "Sin rubro") : `${p.descripcion} · ${p.etapa}${req}`;
        const x = grupos.get(g) ?? { grupo: g, partidas: 0, presupuestado: 0, comprado: 0, pagado: 0, por_pagar: 0 };
        const pg = p.partida_id == null ? undefined : pago.get(p.partida_id);
        x.partidas += 1;
        x.presupuestado += Number(p.parcial ?? 0);
        x.comprado += Number(p.monto_comprado ?? 0);
        x.pagado += pg?.montoPagado ?? 0;
        x.por_pagar += pg?.porPagar ?? 0;
        if (f.por === "partida")
          x.cantidades = { unidad: p.unidad, presupuestada: Number(p.presupuestado ?? 0), comprada: Number(p.comprado ?? 0), pu_presupuesto: Number(p.pu ?? 0) };
        grupos.set(g, x);
      }
      const lista = [...grupos.values()].map((g) => ({
        ...g,
        presupuestado: r2(g.presupuestado),
        comprado: r2(g.comprado),
        pagado: r2(g.pagado),
        por_pagar: r2(g.por_pagar),
        excedido: r2(g.comprado - g.presupuestado),
      }));
      lista.sort((a, b) => b[f.orden] - a[f.orden] || a.grupo.localeCompare(b.grupo, "es"));
      const suma = (k: "presupuestado" | "comprado" | "pagado" | "por_pagar") => r2(lista.reduce((s, g) => s + g[k], 0));
      return json({
        por: f.por,
        partidas: filas.length,
        presupuestado: suma("presupuestado"),
        comprado: suma("comprado"),
        pagado: suma("pagado"),
        por_pagar: suma("por_pagar"),
        grupos: lista.slice(0, f.limite),
        grupos_sin_mostrar: Math.max(0, lista.length - f.limite),
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
        fecha: FECHA.optional(),
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
