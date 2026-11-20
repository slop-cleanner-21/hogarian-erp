import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs } from "@/components/list-controls";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { TODOS, filtro } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import { matches } from "@/lib/format";
import { createClient, type Sesion } from "@/lib/supabase/server";
import { ListaSolicitudes, PedirAdicional, type Solicitud } from "./lista";

type Params = Record<string, string | string[] | undefined>;

export const ESTADOS = [
  { value: "PENDIENTE", label: "Por aprobar" },
  { value: "APROBADA", label: "Aprobadas" },
  { value: "RECHAZADA", label: "Rechazadas" },
  { value: TODOS, label: "Todas" },
];

/**
 * Solicitudes de adicionales. Logística las pide y ve en qué quedaron; Gerencia las aprueba (una, varias o todas las
 * filtradas) o las rechaza con su motivo. Filtros: estado (pestañas), obra, quién la pidió, orden y buscador por ítem,
 * obra o motivo.
 */
export async function PaginaAdicionales({ sp, sesion, modo }: { sp: Params; sesion: Sesion; modo: "logistica" | "gerencia" }) {
  const supabase = await createClient();
  const estado = typeof sp.estado === "string" ? sp.estado : "PENDIENTE";
  const obra = filtro(sp, "obra");
  const quien = filtro(sp, "quien");
  const orden = typeof sp.orden === "string" ? sp.orden : "fecha.asc";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const [filas, { data: obras }, { data: perfiles }, { count: porAprobar }] = await Promise.all([
    todas((a, b) => {
      let query = supabase
        .from("adicional_solicitudes")
        .select("id, obra_id, motivo, estado, requerimiento, respuesta, solicitado_by, solicitado_at, resuelto_by, resuelto_at, adicional_solicitud_partidas(id, etapa, item_id, cantidad, pu)")
        .order("solicitado_at", { ascending: orden !== "fecha.desc" })
        .order("id")
        .range(a, b);
      if (estado !== TODOS) query = query.eq("estado", estado);
      if (obra) query = query.eq("obra_id", Number(obra));
      if (quien) query = query.eq("solicitado_by", quien);
      return query;
    }),
    supabase.from("obras").select("id, nombre, estado, presupuesto_estado, empresas(nombre)").order("nombre"),
    supabase.from("perfiles").select("user_id, nombre"),
    supabase.from("adicional_solicitudes").select("id", { count: "exact", head: true }).eq("estado", "PENDIENTE"),
  ]);
  const ids = [...new Set(filas.flatMap((s) => s.adicional_solicitud_partidas.map((p) => p.item_id)))];
  const items = ids.length ? ((await supabase.from("items").select("id, descripcion, unidad").in("id", ids)).data ?? []) : [];
  const item = new Map(items.map((i) => [i.id, i]));
  const nombreObra = new Map((obras ?? []).map((o) => [o.id, o.nombre]));
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id, p.nombre]));

  const solicitudes: Solicitud[] = filas
    .map((s) => {
      const partidas = s.adicional_solicitud_partidas
        .map((p) => ({
          id: p.id,
          etapa: p.etapa,
          descripcion: item.get(p.item_id)?.descripcion ?? "",
          unidad: item.get(p.item_id)?.unidad ?? "",
          cantidad: Number(p.cantidad),
          pu: Number(p.pu),
        }))
        .sort((a, b) => a.id - b.id);
      return {
        id: s.id,
        obra: nombreObra.get(s.obra_id) ?? "",
        motivo: s.motivo,
        estado: s.estado as Solicitud["estado"],
        requerimiento: s.requerimiento,
        respuesta: s.respuesta,
        solicitante: nombre.get(s.solicitado_by) ?? "",
        solicitadoAt: s.solicitado_at,
        resolvio: s.resuelto_by ? (nombre.get(s.resuelto_by) ?? "") : null,
        resueltoAt: s.resuelto_at,
        partidas,
        total: partidas.reduce((a, p) => a + Math.round(p.cantidad * p.pu * 100) / 100, 0),
      };
    })
    .filter((s) => !q || matches(`${s.obra} ${s.motivo} ${s.partidas.map((p) => p.descripcion).join(" ")}`, q))
    .sort((a, b) => (orden === "monto.desc" ? b.total - a.total : 0));

  // Para pedir: las obras con el presupuesto publicado y sin cerrar; el catálogo y las etapas.
  const pedir =
    modo === "logistica"
      ? await Promise.all([
          todas((a, b) => supabase.from("items").select("id, descripcion, unidad").order("descripcion").range(a, b)),
          supabase.from("etapas").select("codigo").order("orden"),
        ]).then(([catalogo, { data: etapas }]) => ({
          obras: (obras ?? [])
            .filter((o) => o.presupuesto_estado === "PUBLICADO" && o.estado !== "CERRADA")
            .map((o) => ({ id: o.id, nombre: o.nombre, empresa: (o.empresas as unknown as { nombre: string } | null)?.nombre ?? "" })),
          items: catalogo.map((i) => ({ id: i.id, descripcion: i.descripcion, unidad: i.unidad ?? "" })),
          etapas: (etapas ?? []).map((e) => e.codigo),
        }))
      : null;

  const solicitantes = [...new Map(filas.map((s) => [s.solicitado_by, nombre.get(s.solicitado_by) ?? ""]))].sort((a, b) => a[1].localeCompare(b[1]));
  const conSolicitudes = [...new Set(filas.map((s) => s.obra_id))];

  return (
    <>
      <TopBar
        title="Adicionales"
        right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />}
      />
      <RecordarFiltros clave={`adicionales-${modo}`} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
        {pedir && <PedirAdicional {...pedir} />}
        <Tabs param="estado" current={estado} options={ESTADOS.map((e) => ({ ...e, cuenta: e.value === "PENDIENTE" ? (porAprobar ?? 0) : undefined }))} />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="Ítem, obra o motivo" />
          </div>
          <FiltroOrden
            ordenDefault="fecha.asc"
            orden={[
              { value: "fecha.asc", label: "Más antiguas primero" },
              { value: "fecha.desc", label: "Más recientes primero" },
              { value: "monto.desc", label: "Mayor monto" },
            ]}
            filtros={[
              {
                param: "obra",
                label: "Obra",
                options: (obras ?? [])
                  .filter((o) => conSolicitudes.includes(o.id) || String(o.id) === obra)
                  .map((o) => ({ value: String(o.id), label: o.nombre })),
              },
              { param: "quien", label: "Pedida por", options: solicitantes.map(([value, label]) => ({ value, label })) },
            ]}
          />
        </div>
        <ListaSolicitudes solicitudes={solicitudes} aprobar={modo === "gerencia"} conEstado={estado === TODOS} />
      </main>
    </>
  );
}
