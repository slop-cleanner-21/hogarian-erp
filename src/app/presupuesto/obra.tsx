import { notFound } from "next/navigation";
import { EditorPresupuesto, type PartidaPresupuesto } from "@/components/editor-presupuesto";
import { TopBar } from "@/components/shell";
import { todas } from "@/lib/paginar";
import { createClient } from "@/lib/supabase/server";
import { fecha } from "@/lib/format";
import { CerrarObra, PublicarPresupuesto } from "./obra-cliente";
import { DetraccionesObra } from "./detracciones";
import { AdicionalesObra } from "./adicionales";

/**
 * Obra con su presupuesto editable (prod 1: sin personas asignadas ni retenciones de mano de obra). Solo Gerencia carga el presupuesto:
 * lo arma en borrador, lo publica y después puede seguir modificándolo (adicionales de OS).
 */
export async function PaginaObra({ obraId, volver }: { obraId: number; volver: string }) {
  const supabase = await createClient();
  const [{ data: obra }, partidas, avance, items, { data: etapas }, { data: reqs }, { data: detracciones }] = await Promise.all([
    supabase.from("obras").select("id, nombre, direccion, presupuesto_estado, estado, cerrada_at, empresas(nombre)").eq("id", obraId).maybeSingle(),
    todas((a, b) => supabase.from("partidas").select("id, etapa, requerimiento, item_id, cantidad, pu").eq("obra_id", obraId).order("id").range(a, b)),
    todas((a, b) => supabase.from("v_avance_partida").select("partida_id, comprado").eq("obra_id", obraId).range(a, b)),
    todas((a, b) => supabase.from("items").select("id, descripcion, unidad, rubro").order("descripcion").range(a, b)),
    supabase.from("etapas").select("codigo").order("orden"),
    supabase.from("requerimientos").select("codigo").order("orden"),
    supabase.from("detracciones").select("item_id, porcentaje").eq("obra_id", obraId),
  ]);
  if (!obra) notFound();
  const comprado = new Map(avance.map((a) => [a.partida_id, Number(a.comprado)]));
  const filas: PartidaPresupuesto[] = partidas.map((p) => ({
    id: p.id,
    etapa: p.etapa,
    requerimiento: p.requerimiento,
    itemId: p.item_id,
    cantidad: Number(p.cantidad),
    pu: p.pu == null ? null : Number(p.pu),
    comprado: comprado.get(p.id) ?? 0,
  }));
  const borrador = obra.presupuesto_estado === "BORRADOR";
  const itemDe = new Map(items.map((i) => [i.id, i]));

  // Ítems del presupuesto de la obra (para marcar los que llevan detracción).
  const itemsObra = [...new Set(partidas.map((p) => p.item_id))]
    .map((id) => itemDe.get(id))
    .filter((i) => i != null)
    .map((i) => ({ itemId: i.id, descripcion: i.descripcion }))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion));

  return (
    <>
      <TopBar title={obra.nombre} back={volver} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3 lg:max-w-6xl">
        <section className="rounded-panel bg-surface p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-ink-3">Empresa</dt>
            <dd>{(obra.empresas as unknown as { nombre: string } | null)?.nombre}</dd>
            {obra.direccion && (
              <>
                <dt className="text-ink-3">Dirección</dt>
                <dd>{obra.direccion}</dd>
              </>
            )}
            <dt className="text-ink-3">Presupuesto</dt>
            <dd className={borrador ? "font-semibold text-warn" : undefined}>{borrador ? "En borrador" : "Publicado"}</dd>
            {obra.estado === "CERRADA" && (
              <>
                <dt className="text-ink-3">Estado</dt>
                <dd className="font-semibold">Cerrada{obra.cerrada_at ? ` el ${fecha(obra.cerrada_at)}` : ""}</dd>
              </>
            )}
          </dl>
          {borrador && <PublicarPresupuesto obraId={obraId} vacio={filas.length === 0} />}
          {!borrador && obra.estado !== "CERRADA" && <CerrarObra obraId={obraId} />}
        </section>

        {/* Prod 1: Gerencia agrega los adicionales directo, con el presupuesto ya publicado. */}
        {!borrador && (
          <AdicionalesObra
            obraId={obraId}
            partidas={filas.map((f) => ({ id: f.id!, etapa: f.etapa, requerimiento: f.requerimiento, itemId: f.itemId!, cantidad: f.cantidad, pu: f.pu }))}
            items={items.map((i) => ({ id: i.id, descripcion: i.descripcion, unidad: i.unidad ?? "" }))}
            etapas={(etapas ?? []).map((e) => e.codigo)}
            editable={obra.estado !== "CERRADA"}
          />
        )}

        <h2 className="rotulo px-1 pt-2 text-[21px] font-semibold">Presupuesto</h2>
        <EditorPresupuesto
          // Al cambiar el presupuesto en la base (guardar, otra persona), el editor parte de cero.
          key={filas.map((f) => `${f.id}:${f.etapa}:${f.requerimiento}:${f.itemId}:${f.cantidad}:${f.pu}`).join("|")}
          obraId={obraId}
          partidas={filas}
          items={items.map((i) => ({ id: i.id, descripcion: i.descripcion, unidad: i.unidad ?? "", rubro: i.rubro }))}
          etapas={(etapas ?? []).map((e) => e.codigo)}
          requerimientos={(reqs ?? []).map((r) => r.codigo)}
          editable={obra.estado !== "CERRADA"}
        />
        {/* Prod 1: sin residentes ni valorizaciones, no hay personas de obra ni retenciones de mano de obra. */}
        {obra.estado !== "CERRADA" && (
          <DetraccionesObra
            obraId={obraId}
            items={itemsObra}
            guardadas={Object.fromEntries((detracciones ?? []).map((d) => [d.item_id, Number(d.porcentaje)]))}
          />
        )}
      </main>
    </>
  );
}
