import type { Metadata } from "next";
import Link from "next/link";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, VerMas } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { fecha, money } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { ESTADO_LABEL, type EstadoOC } from "@/lib/types";

export const metadata: Metadata = { title: "Órdenes" };

/** Órdenes de todas las obras, solo para consultar (sin acciones). */
export default async function OrdenesGerenciaPage({ searchParams }: PageProps<"/gerencia/ordenes">) {
  const sesion = await requireSesion(["GERENCIA"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["fecha", "total"] as const, "fecha.desc");
  const fObra = filtro(sp, "obra");
  const fEstado = filtro(sp, "estado") as EstadoOC | null;
  const fTipo = filtro(sp, "tipo");
  const supabase = await createClient();

  let query = supabase
    .from("v_ordenes")
    .select("obra_id, numero, tipo, obra, proveedor, fecha, estado, total")
    .order(orden.columna, { ascending: orden.asc, nullsFirst: false })
    // Desempate único: el N° se repite entre obras.
    .order("numero")
    .order("obra_id")
    .limit(limite);
  if (fObra) query = query.eq("obra_id", Number(fObra));
  if (fEstado) query = query.eq("estado", fEstado);
  if (fTipo === "OC" || fTipo === "OS") query = query.eq("tipo", fTipo);
  if (q) {
    const like = `%${q.replace(/[%,()]/g, " ")}%`;
    query = query.or(`numero.ilike.${like},proveedor.ilike.${like},obra.ilike.${like}`);
  }
  const [{ data, error }, { data: obras }] = await Promise.all([query, supabase.from("obras").select("id, nombre").order("nombre")]);
  if (error) throw new Error(error.message);

  return (
    <>
      <TopBar title="Órdenes" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="gerencia-ordenes" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="N°, proveedor u obra" />
          </div>
          <FiltroOrden
            ordenDefault="fecha.desc"
            orden={[
              { value: "fecha.desc", label: "Fecha, más recientes" },
              { value: "fecha.asc", label: "Fecha, más antiguas" },
              { value: "total.desc", label: "Total, mayor a menor" },
            ]}
            filtros={[
              { param: "obra", label: "Obra", options: (obras ?? []).map((o) => ({ value: String(o.id), label: o.nombre })) },
              {
                param: "estado",
                label: "Estado",
                options: (Object.entries(ESTADO_LABEL) as [EstadoOC, string][]).filter(([e]) => e !== "BORRADOR").map(([value, label]) => ({ value, label })),
              },
              {
                param: "tipo",
                label: "Tipo de orden",
                options: [
                  { value: "OC", label: "Orden de compra" },
                  { value: "OS", label: "Orden de servicio" },
                ],
              },
            ]}
          />
        </div>
        <Lista encabezado={[<Pila key="i">{["Orden", "Proveedor", "Obra"]}</Pila>, <Pila key="t">{["Total", "Estado", "Fecha"]}</Pila>]}>
          {data.map((o) => (
            <li key={`${o.obra_id}-${o.numero}`} className="border-b border-line last:border-0">
              <Link
                // Sin precargar cada fila (eran unas 20 peticiones al abrir la lista): el detalle se pide al tocarlo.
                prefetch={false}
                href={`/consulta/orden/${o.obra_id}/${encodeURIComponent(o.numero ?? "")}`}
                className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3 active:bg-ink/8"
              >
                <span className="rotulo text-[22px] font-semibold leading-tight">
                  {o.tipo} {o.numero}
                </span>
                <span className="rotulo text-right text-[21px] font-medium leading-tight">{money(o.total)}</span>
                <span className="truncate text-[15px]">{o.proveedor}</span>
                <span className="text-right text-sm text-ink-2">{o.estado ? ESTADO_LABEL[o.estado] : ""}</span>
                <span className="truncate text-sm text-ink-3">{o.obra}</span>
                <span className="num text-right text-sm text-ink-3">{fecha(o.fecha)}</span>
              </Link>
            </li>
          ))}
          {data.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin órdenes</li>}
        </Lista>
        <VerMas visibles={data.length} limite={limite} />
      </main>
    </>
  );
}
