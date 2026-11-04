import "server-only";
import { qty } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** Adelantos de una partida, ya como texto: "+20 de L2A" (recibido) o "−20 a L1B" (prestado). */
export type MarcasAdelanto = Map<number, string[]>;

/**
 * Adelantos vigentes de una obra (de requerimientos no anulados), por partida. Si se pasa
 * `requerimientoId`, solo los de ese requerimiento.
 */
export async function adelantosDeObra(obraId: number | null, requerimientoIds?: number[]) {
  const supabase = await createClient();
  let q = supabase
    .from("adelantos")
    .select(
      "requerimiento_id, cantidad, partida_origen_id, partida_destino_id, origen:partidas!adelantos_partida_origen_id_fkey(etapa), destino:partidas!adelantos_partida_destino_id_fkey(etapa), items(unidad), requerimientos_obra!inner(estado)",
    )
    .eq("requerimientos_obra.estado", "VIGENTE");
  if (obraId) q = q.eq("obra_id", obraId);
  if (requerimientoIds) q = q.in("requerimiento_id", requerimientoIds.length ? requerimientoIds : [-1]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const filas = data.map((a) => ({
    requerimientoId: a.requerimiento_id,
    cantidad: Number(a.cantidad),
    origenId: a.partida_origen_id,
    destinoId: a.partida_destino_id,
    origenEtapa: (a.origen as unknown as { etapa: string } | null)?.etapa ?? "",
    destinoEtapa: (a.destino as unknown as { etapa: string } | null)?.etapa ?? "",
    unidad: (a.items as unknown as { unidad: string | null } | null)?.unidad ?? "",
  }));
  const marcas: MarcasAdelanto = new Map();
  const agregar = (id: number, texto: string) => marcas.set(id, [...(marcas.get(id) ?? []), texto]);
  for (const a of filas) {
    agregar(a.destinoId, `+${qty(a.cantidad)} de ${a.origenEtapa}`);
    agregar(a.origenId, `−${qty(a.cantidad)} a ${a.destinoEtapa}`);
  }
  return { filas, marcas };
}

export type LineaReq = {
  id: number;
  partidaId: number;
  descripcion: string;
  etapa: string;
  unidad: string;
  grupo: string;
  requerido: number;
  atendido: number;
  pendiente: number;
  /** "toma 20 de L2A" por cada adelanto que cubrió esta línea. */
  adelantos: string[];
};

export type Req = {
  id: number;
  numero: string;
  obraId: number;
  obra: string;
  nota: string | null;
  estado: "VIGENTE" | "ANULADO";
  autorId: string;
  autor: string;
  fecha: string;
  motivoAnulacion: string | null;
  lineas: LineaReq[];
  pendiente: number;
};

const GRUPO_DE_RUBRO = (rubro: string) => (rubro === "MATERIAL" ? "MATERIALES" : rubro === "MANO OBRA" ? "MANO_OBRA" : "SUBCONTRATOS");

/** Requerimientos con sus líneas, lo atendido (por partida, primero los más antiguos) y los adelantos. */
export async function cargarRequerimientos({ obraId, soloVigentes, limite = 60 }: { obraId: number | null; soloVigentes?: boolean; limite?: number }) {
  const supabase = await createClient();
  let q = supabase
    .from("requerimientos_obra")
    .select(
      "id, numero, obra_id, nota, estado, created_by, created_at, motivo_anulacion, obras(nombre), requerimientos_obra_items(id, partida_id, cantidad, partidas(etapa, items(descripcion, unidad, rubro)))",
    )
    .order("created_at", { ascending: false })
    .limit(limite);
  if (obraId) q = q.eq("obra_id", obraId);
  if (soloVigentes) q = q.eq("estado", "VIGENTE");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const ids = data.map((r) => r.id);
  const [{ data: atencion }, { data: perfiles }, { filas: adelantos }] = await Promise.all([
    supabase.from("v_requerimiento_items").select("id, atendido, pendiente").in("requerimiento_id", ids.length ? ids : [-1]),
    supabase.from("perfiles").select("user_id, nombre"),
    adelantosDeObra(null, ids),
  ]);
  const at = new Map((atencion ?? []).map((a) => [a.id!, { atendido: Number(a.atendido), pendiente: Number(a.pendiente) }]));
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id, p.nombre]));
  return data.map<Req>((r) => {
    const lineas = r.requerimientos_obra_items.map<LineaReq>((l) => {
      const p = l.partidas as unknown as { etapa: string; items: { descripcion: string; unidad: string | null; rubro: string } };
      const a = at.get(l.id);
      return {
        id: l.id,
        partidaId: l.partida_id,
        descripcion: p.items.descripcion,
        etapa: p.etapa,
        unidad: p.items.unidad ?? "",
        grupo: GRUPO_DE_RUBRO(p.items.rubro),
        requerido: Number(l.cantidad),
        atendido: a?.atendido ?? 0,
        pendiente: r.estado === "VIGENTE" ? (a?.pendiente ?? Number(l.cantidad)) : 0,
        adelantos: adelantos
          .filter((x) => x.requerimientoId === r.id && x.destinoId === l.partida_id)
          .map((x) => `toma ${qty(x.cantidad)} de ${x.origenEtapa}`),
      };
    });
    return {
      id: r.id,
      numero: r.numero,
      obraId: r.obra_id,
      obra: (r.obras as unknown as { nombre: string } | null)?.nombre ?? "",
      nota: r.nota,
      estado: r.estado as Req["estado"],
      autorId: r.created_by,
      autor: nombre.get(r.created_by) ?? "",
      fecha: r.created_at,
      motivoAnulacion: r.motivo_anulacion,
      lineas,
      pendiente: lineas.reduce((s, l) => s + l.pendiente, 0),
    };
  });
}
