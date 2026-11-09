import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { todas } from "@/lib/paginar";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { CuentaContable, Rubro } from "@/lib/types";

const RUBROS: Rubro[] = ["MATERIAL", "MANO OBRA", "SUBCONTRATO", "LOCACION", "PROYECTO", "FINALIZACION", "OTRO"];
import { CuentasList, type FilaItem } from "./cuentas-list";
import { PlanCuentas } from "./plan-cuentas";
import { RecordarFiltros } from "@/components/recordar-filtros";

export const metadata: Metadata = { title: "Cuentas de ítems" };

export default async function CuentasPage({ searchParams }: PageProps<"/contabilidad">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const tab = sp.tab === "con" || sp.tab === "plan" ? sp.tab : "sin";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const like = `%${q.replace(/[%,()]/g, " ")}%`;
  const orden = ordenDe(sp, ["uso", "descripcion"] as const, "uso.desc");
  const rubro = filtro(sp, "rubro") as Rubro | null;
  const supabase = await createClient();

  // Desde Compras: solo los ítems de un comprobante.
  const comprobanteId = Number(sp.comprobante) || null;
  let itemIds: number[] | null = null;
  let comprobante: string | null = null;
  if (comprobanteId) {
    const [{ data, error }, { data: c }] = await Promise.all([
      supabase.from("v_oc_items").select("item_id").eq("comprobante_id", comprobanteId),
      supabase.from("comprobantes").select("serie, numero").eq("id", comprobanteId).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    itemIds = [...new Set(data.map((d) => d.item_id!))];
    comprobante = c ? `${c.serie}-${c.numero}` : null;
  }

  const filas = async (): Promise<FilaItem[]> => {
    if (tab === "sin") {
      let query = supabase
        .from("v_items_sin_cuenta")
        .select("item_id, descripcion, unidad, rubro, n_oc_items")
        .order(orden.columna === "uso" ? "n_oc_items" : "descripcion", { ascending: orden.asc, nullsFirst: false })
        .order("descripcion")
        .limit(limite);
      if (rubro) query = query.eq("rubro", rubro);
      if (q) query = query.ilike("descripcion", like);
      if (itemIds) query = query.in("item_id", itemIds);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data.map((d) => ({
        id: d.item_id,
        descripcion: d.descripcion,
        unidad: d.unidad ?? "",
        rubro: d.rubro,
        cuenta: null,
      }));
    }
    let query = supabase
      .from("items")
      .select("id, descripcion, unidad, rubro, cuenta:cuenta_contable")
      .not("cuenta_contable", "is", null)
      .order(orden.columna === "uso" ? "cuenta_contable" : "descripcion", { ascending: orden.columna === "uso" || orden.asc })
      .order("descripcion")
      .limit(limite);
    if (rubro) query = query.eq("rubro", rubro);
    if (q) query = query.ilike("descripcion", like);
    if (itemIds) query = query.in("id", itemIds);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data.map((d) => ({ ...d, unidad: d.unidad ?? "" }));
  };

  if (tab === "plan") {
    const [{ data: cuentas, error }, usos] = await Promise.all([
      supabase.from("cuentas_contables").select("*").order("codigo"),
      todas((a, b) => supabase.from("items").select("cuenta_contable").not("cuenta_contable", "is", null).order("id").range(a, b)),
    ]);
    if (error) throw new Error(error.message);
    const porCuenta = new Map<string, number>();
    for (const u of usos) porCuenta.set(u.cuenta_contable!, (porCuenta.get(u.cuenta_contable!) ?? 0) + 1);
    // La búsqueda del plan usa su propio parámetro: no se arrastra a las pestañas de ítems.
    const texto = (typeof sp.buscar === "string" ? sp.buscar.trim() : "").toLowerCase();
    const plan = cuentas
      .filter((c) => !texto || c.codigo.includes(texto) || c.denominacion.toLowerCase().includes(texto))
      .map((c) => ({ ...c, items: porCuenta.get(c.codigo) ?? 0 }));
    return (
      <>
        <TopBar title="Plan de cuentas" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
        <RecordarFiltros clave="cuentas" />
        <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3">
          <SearchBox placeholder="Código o denominación" param="buscar" />
          <TabsCuentas tab={tab} />
          <PlanCuentas cuentas={plan} opciones={cuentas.map((c) => ({ value: c.codigo, label: c.codigo, hint: c.denominacion }))} />
        </main>
      </>
    );
  }

  const [items, { data: cuentas }] = await Promise.all([
    filas(),
    supabase.from("cuentas_contables").select("*").order("codigo"),
  ]);

  return (
    <>
      <TopBar
        title="Cuentas"
        back={comprobanteId ? true : undefined}
        right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />}
      />
      <RecordarFiltros clave="cuentas" ignorar={["comprobante"]} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3 lg:max-w-5xl">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="Descripción" />
          </div>
          <FiltroOrden
            ordenDefault="uso.desc"
            orden={[
              { value: "uso.desc", label: tab === "sin" ? "Más comprados primero" : "Cuenta contable" },
              { value: "descripcion.asc", label: "Descripción, A a Z" },
              { value: "descripcion.desc", label: "Descripción, Z a A" },
            ]}
            filtros={[{ param: "rubro", label: "Rubro", options: RUBROS.map((r) => ({ value: r, label: r })) }]}
          />
        </div>
        <TabsCuentas tab={tab} />
        {comprobanteId && (
          // Desde Compras: solo los ítems de ese comprobante; la X muestra todos.
          <Link
            href={`/contabilidad?tab=${tab}`}
            prefetch={false}
            aria-label="Ver todos los ítems"
            className="num flex min-h-11 w-fit items-center gap-2 rounded-full border border-line bg-surface pl-4 pr-3 text-[15px] active:bg-ink/8"
          >
            Comprobante {comprobante ?? comprobanteId}
            <X size={18} className="shrink-0 text-ink-3" />
          </Link>
        )}
        <CuentasList items={items} cuentas={(cuentas ?? []) as CuentaContable[]} filtros={{ tab, q, rubro, comprobanteId }} />
        <VerMas visibles={items.length} limite={limite} />
      </main>
    </>
  );
}

function TabsCuentas({ tab }: { tab: string }) {
  return (
    <Tabs
      param="tab"
      current={tab}
      quitar={tab === "plan" ? ["buscar"] : []}
      options={[
        { value: "sin", label: "Sin cuenta" },
        { value: "con", label: "Asignadas" },
        { value: "plan", label: "Plan" },
      ]}
    />
  );
}
