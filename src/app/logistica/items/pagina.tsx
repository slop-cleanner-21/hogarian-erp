import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { TopBar, UserMenu } from "@/components/shell";
import { SIN_TIPO, filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import type { Sesion } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import type { Item, Rubro } from "@/lib/types";
import { ItemsList } from "./items-list";
import { RecordarFiltros } from "@/components/recordar-filtros";

// Materiales (se compran con OC) y servicios (mano de obra, subcontratos y demás: se contratan con OS).
const RUBROS_SERVICIO: Rubro[] = ["MANO OBRA", "SUBCONTRATO", "LOCACION", "PROYECTO", "FINALIZACION", "OTRO"];

/**
 * Catálogo de ítems (materiales y servicios), común a Logística y Gerencia. Gerencia los crea (con la cuenta
 * contable, opcional); Logística los clasifica por tipo de material o especialidad.
 */
export async function PaginaItems({ sp, sesion, modo }: { sp: Record<string, string | string[] | undefined>; sesion: Sesion; modo: "logistica" | "gerencia" }) {
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const clase = sp.clase === "serv" ? "serv" : "mat";
  const rubro = filtro(sp, "rubro") as Rubro | null;
  const tipo = filtro(sp, "tipo");
  const unidad = filtro(sp, "unidad");
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["descripcion", "unidad", "numero", "rubro"] as const, "descripcion.asc");
  const supabase = await createClient();
  // Plan de cuentas y catálogo completo (para avisar de nombres parecidos) del ítem nuevo: solo Gerencia lo crea.
  const cuentas =
    modo === "gerencia"
      ? supabase
          .from("cuentas_contables")
          .select("codigo, denominacion")
          .order("codigo")
          .then((r) => r.data)
      : null;
  const catalogo =
    modo === "gerencia" ? todas((a, b) => supabase.from("items").select("id, descripcion, unidad, rubro").order("id").range(a, b)) : null;

  let query = supabase
    .from("items")
    .select("*")
    .order(orden.columna, { ascending: orden.asc, nullsFirst: false })
    .order("descripcion")
    .limit(limite);
  if (clase === "mat") query = query.eq("rubro", "MATERIAL");
  else if (rubro && RUBROS_SERVICIO.includes(rubro)) query = query.eq("rubro", rubro);
  else query = query.neq("rubro", "MATERIAL");
  if (unidad) query = query.eq("unidad", unidad);
  if (q) query = query.ilike("descripcion", `%${q.replace(/[%,()]/g, " ")}%`);
  if (tipo === SIN_TIPO) query = query.is("tipo_material", null);
  else if (tipo) query = query.eq("tipo_material", tipo);

  const [{ data }, unidades, { data: tipos }] = await Promise.all([
    query,
    todas((a, b) => supabase.from("items").select("unidad").order("id").range(a, b)),
    supabase.from("tipos_material").select("codigo").order("orden"),
  ]);
  const tiposMaterial = (tipos ?? []).map((t) => t.codigo as string);
  const listaUnidades = [...new Set(unidades.map((u) => u.unidad).filter((u): u is string => !!u))].sort();

  return (
    <>
      <TopBar title="Ítems" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave={modo === "gerencia" ? "items-gerencia" : "items"} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <Tabs
          param="clase"
          current={clase}
          options={[
            { value: "mat", label: "Materiales" },
            { value: "serv", label: "Servicios" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="Descripción" />
          </div>
          <FiltroOrden
            ordenDefault="descripcion.asc"
            orden={[
              { value: "descripcion.asc", label: "Descripción, A a Z" },
              { value: "descripcion.desc", label: "Descripción, Z a A" },
              { value: "unidad.asc", label: "Unidad" },
              ...(clase === "serv" ? [{ value: "rubro.asc", label: "Rubro" }] : []),
              { value: "numero.asc", label: "N° de ítem (Excel)" },
            ]}
            filtros={[
              ...(clase === "serv"
                ? [{ param: "rubro", label: "Rubro", options: RUBROS_SERVICIO.map((r) => ({ value: r, label: r })) }]
                : []),
              {
                param: "tipo",
                label: clase === "mat" ? "Tipo de material" : "Especialidad",
                options: [...tiposMaterial.map((t) => ({ value: t, label: t })), { value: SIN_TIPO, label: "Sin tipo" }],
              },
              { param: "unidad", label: "Unidad", options: listaUnidades.map((u) => ({ value: u, label: u })) },
            ]}
          />
        </div>
        <ItemsList
          items={(data ?? []) as Item[]}
          unidades={listaUnidades}
          tipos={tiposMaterial}
          clase={clase}
          rubroDefault={clase === "mat" ? "MATERIAL" : (rubro ?? "MANO OBRA")}
          tipoDefault={tipo === SIN_TIPO ? null : tipo}
          clasificar={modo === "logistica"}
          crear={modo === "gerencia" ? { cuentas: (await cuentas) ?? [], catalogo: (await catalogo) ?? [] } : null}
        />
        <VerMas visibles={data?.length ?? 0} limite={limite} />
      </main>
    </>
  );
}
