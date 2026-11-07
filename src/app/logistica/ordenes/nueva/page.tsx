import type { Metadata } from "next";
import { todas } from "@/lib/paginar";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { BorradorCuenta, DatosBorrador } from "@/lib/borrador-orden";
import type { VPartida } from "@/lib/types";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { NuevaOrden, type Venta } from "./nueva-orden";

export async function generateMetadata({ searchParams }: PageProps<"/logistica/ordenes/nueva">): Promise<Metadata> {
  return { title: (await searchParams).tipo === "OS" ? "Nueva OS" : "Nueva OC" };
}

export default async function NuevaOrdenPage({ searchParams }: PageProps<"/logistica/ordenes/nueva">) {
  const sp = await searchParams;
  const { userId } = await requireSesion(["LOGISTICA"]);
  const tipo = sp.tipo === "OS" ? "OS" : "OC";
  const obraId = Number(sp.obra) || null;
  const supabase = await createClient();
  // Retomar un borrador de la cuenta (solo se ven los propios).
  const borradorId = Number(sp.borrador) || null;
  const { data: filaBorrador } = borradorId
    ? await supabase.from("orden_borradores").select("id, datos, updated_at").eq("id", borradorId).eq("tipo", tipo).eq("obra_id", obraId ?? 0).maybeSingle()
    : { data: null };
  const borrador: BorradorCuenta | null = filaBorrador
    ? { id: filaBorrador.id, datos: filaBorrador.datos as unknown as DatosBorrador, actualizado: filaBorrador.updated_at }
    : null;

  // Partidas de la obra: por páginas (la API corta cada respuesta en 1000 filas), solo las columnas que usa la
  // pantalla. Prod 1 (sin valorizaciones): la mano de obra se ordena en OS, como los subcontratos.
  const pagina = (a: number, b: number) => {
    const q = supabase
      .from("v_partidas")
      .select("id, codigo, etapa, requerimiento, item_id, descripcion, unidad, rubro, pu, cantidad, cant_comprometida, saldo_cant, tipo_material, cantidad_efectiva")
      .eq("obra_id", obraId!)
      .order("etapa")
      .order("codigo")
      .order("id");
    return (tipo === "OC" ? q.eq("rubro", "MATERIAL") : q.neq("rubro", "MATERIAL")).range(a, b);
  };

  // Obras y proveedores por páginas: pasadas las 1000 filas, los que quedaran fuera no se podrían elegir
  // ni saldrían sugeridos aunque hayan vendido el ítem. Con la obra (viene en la URL), sus partidas y el
  // siguiente número van en la misma ola.
  const [obras, proveedores, { data: tiposMaterial }, data, { data: num }] = await Promise.all([
    todas((a, b) => supabase.from("obras").select("id, nombre, empresas(nombre)").order("nombre").order("id").range(a, b)),
    todas((a, b) =>
      supabase
        .from("proveedores")
        .select("id, ruc_o_cod, razon_social, comprobante_habitual, suspension_4ta_fecha, tipos:proveedor_tipos_material(tipo_material)")
        .order("razon_social")
        .order("id")
        .range(a, b),
    ),
    supabase.from("tipos_material").select("codigo").order("orden"),
    obraId ? todas(pagina) : Promise.resolve([]),
    obraId ? supabase.rpc("siguiente_numero_oc", { p_obra_id: obraId }) : Promise.resolve({ data: null }),
  ]);

  let partidas: VPartida[] = [];
  let siguiente = "";
  let historial: Venta[] = [];
  let atender: { numero: string; lineas: Record<number, number> } | null = null;
  const requeridos: Record<number, number> = {};
  if (obraId) {
    partidas = data as VPartida[];
    siguiente = String(num ?? "");
    // Quién ya vendió estos ítems (en cualquier obra): se sugieren primero al elegir proveedor.
    const itemIds = [...new Set(partidas.map((p) => p.item_id).filter((i): i is number => i != null))];
    const ventas = new Map<string, Venta>();
    // El P.U. es el de la última orden con precio (la más reciente puede no tenerlo aún).
    const fechaPu = new Map<string, string>();
    // Por páginas: la API corta cada respuesta en 1000 filas y un bloque de ítems puede tener más ventas (con
    // `.limit` se perdían en silencio y el ítem quedaba como si nadie lo hubiera vendido). Los bloques (de 300
    // ítems, por el largo de la URL) van a la vez: cada uno tiene ítems distintos, el orden entre ellos no importa.
    const bloques = await Promise.all(
      Array.from({ length: Math.ceil(itemIds.length / 300) }, (_, k) =>
        todas((a, b) =>
          supabase
            .from("v_oc_items_calc")
            .select("item_id, proveedor_id, fecha, pu_efectivo, pu_bruto")
            .in("item_id", itemIds.slice(k * 300, k * 300 + 300))
            .neq("estado", "ANULADA")
            .eq("es_retencion", false)
            .order("id")
            .range(a, b),
        ),
      ),
    );
    for (const lineas of bloques) {
      for (const l of lineas) {
        const k = `${l.item_id}-${l.proveedor_id}`;
        const previa = ventas.get(k);
        const conPu = l.pu_efectivo != null && (fechaPu.get(k) ?? "") <= l.fecha;
        if (conPu) fechaPu.set(k, l.fecha);
        const pu = conPu ? Number(l.pu_bruto ?? l.pu_efectivo) : (previa?.[3] ?? null);
        ventas.set(k, [l.item_id, l.proveedor_id, !previa || previa[2] < l.fecha ? l.fecha : previa[2], pu]);
      }
    }
    historial = [...ventas.values()];
    // Atender un requerimiento: lo que falta de sus partidas de este tipo, sin pasar el saldo.
    const reqId = Number(sp.req) || null;
    if (reqId) {
      const { data: faltan } = await supabase
        .from("v_requerimiento_items")
        .select("numero, partida_id, pendiente, grupo")
        .eq("requerimiento_id", reqId)
        .eq("obra_id", obraId)
        .gt("pendiente", 0);
      const saldo = new Map(partidas.map((p) => [p.id!, Number(p.saldo_cant)]));
      const lineas: Record<number, number> = {};
      for (const f of faltan ?? []) {
        const s = saldo.get(f.partida_id!);
        if (s == null || s <= 0) continue; // no es de este tipo de orden o ya no hay saldo
        lineas[f.partida_id!] = Math.min(Number(f.pendiente), s);
      }
      if (faltan?.length) atender = { numero: faltan[0].numero!, lineas };
    }
    // Prod 1: sin requerimientos (no hay pendientes que marcar).
  }

  return (
    <>
      <RecordarFiltros clave="nueva" base={["tipo"]} ignorar={["req", "borrador"]} />
      <NuevaOrden
      key={`${obraId ?? 0}-${sp.req ?? ""}-${borrador?.id ?? ""}`}
      usuario={userId}
      borrador={borrador}
      tipo={tipo}
      obraId={obraId}
      obras={(obras ?? []).map((o) => ({
        id: o.id as number,
        nombre: o.nombre as string,
        empresa: ((o.empresas as unknown as { nombre: string } | null)?.nombre ?? "") as string,
      }))}
      proveedores={(proveedores ?? []).map((p) => ({
        id: p.id,
        ruc_o_cod: p.ruc_o_cod,
        razon_social: p.razon_social,
        comprobante_habitual: p.comprobante_habitual,
        suspension_4ta_fecha: p.suspension_4ta_fecha,
        tipos: p.tipos.map((t) => t.tipo_material),
      }))}
      partidas={partidas}
      historial={historial}
      requeridos={requeridos}
      atender={atender}
      tiposMaterial={(tiposMaterial ?? []).map((t) => t.codigo)}
      siguienteNumero={siguiente}
      filtros={{
        etapa: typeof sp.etapa === "string" ? sp.etapa : null,
        req: typeof sp.req === "string" ? sp.req : null,
        tmat: typeof sp.tmat === "string" ? sp.tmat : null,
        orden: typeof sp.orden === "string" ? sp.orden : null,
        vista: typeof sp.vista === "string" ? sp.vista : null,
        q: typeof sp.q === "string" ? sp.q : null,
      }}
    />
    </>
  );
}
