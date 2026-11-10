import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import type { Metadata } from "next";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { PagosList } from "@/components/pagos-list";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { listarPagos } from "@/lib/queries";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { ContabilizarTodos } from "./contabilizar-todos";

const ORDEN_PAGOS = [
  { value: "fecha.desc", label: "Fecha, más recientes" },
  { value: "fecha.asc", label: "Fecha, más antiguos" },
  { value: "monto.desc", label: "Monto, mayor a menor" },
  { value: "monto.asc", label: "Monto, menor a mayor" },
  { value: "numero_operacion.asc", label: "N° de operación" },
];

export const metadata: Metadata = { title: "Pagos contables" };

export default async function PagosContablesPage({ searchParams }: PageProps<"/contabilidad/pagos">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const tab = sp.tab === "con" ? "con" : "sin";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["fecha", "monto", "numero_operacion"] as const, "fecha.desc");
  const banco = filtro(sp, "banco");
  const empresa = Number(filtro(sp, "empresa")) || null;
  const supabase = await createClient();
  const [pagos, { data: bancos }, { data: cuentas }, { data: empresas }] = await Promise.all([
    listarPagos({ contabilizados: tab === "con", q, limite, orden, banco, empresa }),
    supabase.from("pagos").select("banco").not("banco", "is", null).limit(1000),
    supabase.from("cuentas_contables").select("codigo, denominacion").order("codigo"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
  ]);
  return (
    <>
      <TopBar title="Pagos" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="pagos-contables" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="N° de operación" />
          </div>
          <FiltroOrden
            ordenDefault="fecha.desc"
            orden={ORDEN_PAGOS}
            filtros={[
              {
                param: "empresa",
                label: "Empresa",
                todos: "Todas",
                options: (empresas ?? []).map((e) => ({ value: String(e.id), label: e.nombre })),
              },
              {
                param: "banco",
                label: "Banco",
                options: [...new Set((bancos ?? []).map((b) => b.banco!))].sort().map((b) => ({ value: b, label: b })),
              },
            ]}
          />
        </div>
        <Tabs
          param="tab"
          current={tab}
          options={[
            { value: "sin", label: "Por contabilizar" },
            { value: "con", label: "Contabilizados" },
          ]}
        />
        {tab === "sin" && <ContabilizarTodos ids={pagos.map((p) => p.id)} />}
        <PagosList pagos={pagos} contabilidad cuentas={cuentas ?? []} />
        <VerMas visibles={pagos.length} limite={limite} />
      </main>
    </>
  );
}
