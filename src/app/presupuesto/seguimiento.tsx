import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs } from "@/components/list-controls";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { SeguimientoPresupuesto } from "@/components/seguimiento-filas";
import { tramosDe, type FilaSeguimiento } from "@/components/seguimiento-presupuesto";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { TODOS, filtro } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import { GRUPOS, grupoDe } from "@/lib/presupuesto";
import { adelantosDeObra } from "@/lib/requerimientos";
import { entregasPorPartida, type EntregaPartida } from "@/lib/entregas-partida";
import { createClient, type Sesion } from "@/lib/supabase/server";

type Params = Record<string, string | string[] | undefined>;

// Filtro de estado: los mismos nombres de la barra (más «completo»).
const FILTRO: Record<string, string> = {
  porRequerir: "pedir",
  requeridoPendiente: "requerido",
  enLogistica: "logistica",
  enTesoreria: "tesoreria",
  porRecibir: "recibir",
  recibido: "recibido",
};

/** Seguimiento de los 3 presupuestos de una obra (Operaciones). */
export async function PaginaSeguimiento({ sp, sesion, clave, titulo }: { sp: Params; sesion: Sesion; clave: string; titulo: string }) {
  const supabase = await createClient();
  const grupo = grupoDe(sp.grupo);
  const etapa = filtro(sp, "etapa");
  const estado = filtro(sp, "estado");
  const q = typeof sp.q === "string" ? sp.q.trim().toUpperCase() : "";

  const obrasQ = supabase.from("obras").select("id, nombre, empresa_id, empresas(nombre)").eq("presupuesto_estado", "PUBLICADO").order("nombre");
  const [{ data: obras, error }, { data: etapas }] = await Promise.all([obrasQ, supabase.from("etapas").select("codigo").order("orden")]);
  if (error) throw new Error(error.message);
  const empresas = [...new Map(obras.map((o) => [String(o.empresa_id), (o.empresas as unknown as { nombre: string } | null)?.nombre ?? ""]))].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const empresa = filtro(sp, "empresa");
  const lista = empresa ? obras.filter((o) => String(o.empresa_id) === empresa) : obras;
  const obraId = lista.find((o) => String(o.id) === sp.obra)?.id ?? lista[0]?.id ?? null;
  // Orden de etapas de la obra (lo define el Jefe de Operaciones), adelantos vigentes, entregas y las partidas:
  // todo en una sola ola (solo necesitan la obra).
  const [{ data: ordenObra }, { marcas }, entregas, partidas] = obraId
    ? await Promise.all([
        supabase.from("obra_etapas").select("etapa").eq("obra_id", obraId).order("orden"),
        adelantosDeObra(obraId),
        // Lo que llegó con sus fotos, por partida.
        entregasPorPartida(obraId),
        todas((a, b) =>
          supabase
            .from("v_seguimiento_partida")
            .select(
              "partida_id, etapa, requerimiento, descripcion, unidad, presupuesto_efectivo, pu, en_logistica, en_tesoreria, por_recibir, recibido, requerido, ejecutado_sin_valorizar, valorizado_sin_pagar, valorizado_pagado, retencion_acumulada",
            )
            .eq("obra_id", obraId)
            .eq("grupo", grupo)
            .order("orden_etapa")
            .order("partida_id")
            .range(a, b),
        ),
      ])
    : [{ data: [] }, { marcas: new Map<number, string[]>() }, {} as Record<number, EntregaPartida[]>, []];

  const filas: FilaSeguimiento[] = obraId
    ? partidas
        .map((f): FilaSeguimiento => {
          const base = {
            id: f.partida_id,
            etapa: f.etapa,
            descripcion: f.descripcion,
            requerimiento: f.requerimiento,
            unidad: f.unidad ?? "",
            // Con adelantos, lo que cuenta es el presupuesto efectivo; las marcas explican la diferencia.
            presupuestado: Number(f.presupuesto_efectivo),
            pu: f.pu == null ? null : Number(f.pu),
            adelantos: marcas.get(f.partida_id) ?? [],
            entregas: entregas[f.partida_id] ?? [],
          };
          const comprometido = Number(f.en_logistica) + Number(f.en_tesoreria) + Number(f.por_recibir) + Number(f.recibido);
          // Prod 1: la mano de obra sigue el recorrido de las OS (sin avances ni valorizaciones).
          if (false as boolean) {
            // Avance del residente: sin valorizar, valorizado sin pagar y pagado (más las OS de antes).
            const sinValorizar = Number(f.ejecutado_sin_valorizar);
            const sinPagar = Number(f.valorizado_sin_pagar) + Number(f.en_logistica) + Number(f.en_tesoreria) + Number(f.por_recibir);
            const pagado = Number(f.valorizado_pagado) + Number(f.recibido);
            return {
              ...base,
              porRequerir: Math.max(Number(f.presupuesto_efectivo) - sinValorizar - sinPagar - pagado, 0),
              requeridoPendiente: 0,
              enLogistica: sinValorizar,
              enTesoreria: sinPagar,
              porRecibir: 0,
              recibido: pagado,
              retencion: Number(f.retencion_acumulada),
            };
          }
          return {
            ...base,
            porRequerir: Math.max(Number(f.presupuesto_efectivo) - Math.max(Number(f.requerido), comprometido), 0),
            enLogistica: Number(f.en_logistica),
            enTesoreria: Number(f.en_tesoreria),
            porRecibir: Number(f.por_recibir),
            recibido: Number(f.recibido),
            requeridoPendiente: Math.max(Number(f.requerido) - comprometido, 0),
          };
        })
        .filter((f) => (!etapa || f.etapa === etapa) && (!q || f.descripcion.includes(q)))
        .filter((f) =>
          estado === "requerido" ? f.requeridoPendiente > 0.0001
          : estado === "pedir" ? f.porRequerir > 0.0001
          : estado === "logistica" ? f.enLogistica > 0.0001
          : estado === "tesoreria" ? f.enTesoreria > 0.0001
          : estado === "recibir" ? f.porRecibir > 0.0001
          : estado === "recibido" ? f.recibido > 0.0001
          : estado === "completo" ? f.recibido >= f.presupuestado - 0.0001
          : true,
        )
    : [];

  const tramos = tramosDe(grupo);
  const estados = [
    ...tramos.filter((t) => FILTRO[t.clave]).map((t) => ({ value: FILTRO[t.clave], label: t.label })),
    { value: "completo", label: `Todo ${tramos[tramos.length - 1].label.toLowerCase()}` },
  ];

  return (
    <>
      <TopBar title={titulo} right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave={clave} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
        <div className={empresas.length > 1 ? "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2" : "grid"}>
          {empresas.length > 1 && (
            <UrlSelect
              param="empresa"
              label="Empresa"
              value={empresa ?? TODOS}
              options={[{ value: TODOS, label: "Todas" }, ...empresas.map(([value, label]) => ({ value, label }))]}
            />
          )}
          <UrlSelect
            param="obra"
            label="Obra"
            value={obraId ? String(obraId) : null}
            options={lista.map((o) => ({ value: String(o.id), label: o.nombre, hint: (o.empresas as unknown as { nombre: string } | null)?.nombre }))}
          />
        </div>
        <Tabs param="grupo" current={grupo} quitar={["estado"]} options={GRUPOS.map((g) => ({ value: g.value, label: g.label }))} />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="Ítem" />
          </div>
          <FiltroOrden
            ordenDefault="etapa.asc"
            orden={[{ value: "etapa.asc", label: "Etapa" }]}
            filtros={[
              {
                param: "etapa",
                label: "Etapa",
                options: (ordenObra?.length ? ordenObra.map((e) => e.etapa) : (etapas ?? []).map((e) => e.codigo)).map((e) => ({ value: e, label: e })),
              },
              { param: "estado", label: "Estado", options: estados },
            ]}
          />
        </div>
        {obraId ? (
          <SeguimientoPresupuesto
            filas={filas}
            grupo={grupo}
            ordenEtapas={[...(ordenObra ?? []).map((e) => e.etapa), ...(etapas ?? []).map((e) => e.codigo)]}
          />
        ) : (
          <p className="py-10 text-center text-ink-3">Sin obras</p>
        )}
      </main>
    </>
  );
}
