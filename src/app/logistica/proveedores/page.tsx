import type { Metadata } from "next";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, VerMas } from "@/components/list-controls";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { TIPO_COMPROBANTE_LABEL, type TipoComprobante } from "@/lib/types";
import { ProveedoresList, type ProveedorFicha } from "./proveedores-list";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { PestanasProveedores } from "./pestanas";

export const metadata: Metadata = { title: "Proveedores" };

const COLUMNAS =
  "*, cuenta:proveedor_cuentas(banco, cuenta_bancaria), contactos:proveedor_contactos(nombre, telefono, whatsapp, telegram), tipos:proveedor_tipos_material(tipo_material)";

export default async function ProveedoresPage({ searchParams }: PageProps<"/logistica/proveedores">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["razon_social", "ruc_o_cod", "banco"] as const, "razon_social.asc");
  const banco = filtro(sp, "banco");
  const comprobante = filtro(sp, "comprobante");
  const tipo = filtro(sp, "tipo");
  const supabase = await createClient();

  // Filtrar por tipo o banco exige un join interno aparte, para no recortar la lista de tipos mostrada.
  const columnas = [
    COLUMNAS,
    ...(tipo ? ["f:proveedor_tipos_material!inner(tipo_material)"] : []),
    ...(banco ? ["fb:proveedor_cuentas!inner(banco)"] : []),
  ].join(", ");
  // El banco está en proveedor_cuentas (1 a 1): se ordena por la columna del embed (con su alias).
  let query = supabase
    .from("proveedores")
    .select(columnas)
    .order(orden.columna === "banco" ? "cuenta(banco)" : orden.columna, { ascending: orden.asc, nullsFirst: false })
    .order("razon_social")
    .limit(limite);
  if (tipo) query = query.eq("f.tipo_material", tipo);
  if (banco) query = query.eq("fb.banco", banco);
  if (comprobante) query = query.eq("comprobante_habitual", comprobante as TipoComprobante);
  if (q) {
    const like = `%${q.replace(/[%,()]/g, " ")}%`;
    query = query.or(`razon_social.ilike.${like},ruc_o_cod.ilike.${like}`);
  }
  const [{ data, error }, { data: bancos }, { data: tipos }] = await Promise.all([
    query,
    supabase.from("proveedor_cuentas").select("banco").not("banco", "is", null),
    supabase.from("tipos_material").select("codigo").order("orden"),
  ]);
  if (error) throw new Error(error.message);
  const tiposMaterial = (tipos ?? []).map((t) => t.codigo);

  return (
    <>
      <TopBar title="Proveedores" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="proveedores" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <PestanasProveedores actual="proveedores" />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="Razón social o RUC" />
          </div>
          <FiltroOrden
            ordenDefault="razon_social.asc"
            orden={[
              { value: "razon_social.asc", label: "Razón social, A a Z" },
              { value: "razon_social.desc", label: "Razón social, Z a A" },
              { value: "ruc_o_cod.asc", label: "RUC / DNI" },
              { value: "banco.asc", label: "Banco" },
            ]}
            filtros={[
              { param: "tipo", label: "Vende", options: tiposMaterial.map((t) => ({ value: t, label: t })) },
              {
                param: "banco",
                label: "Banco",
                options: [...new Set((bancos ?? []).map((b) => b.banco!.trim()))].sort().map((b) => ({ value: b, label: b })),
              },
              {
                param: "comprobante",
                label: "Comprobante habitual",
                options: Object.entries(TIPO_COMPROBANTE_LABEL).map(([value, label]) => ({ value, label })),
              },
            ]}
          />
        </div>
        <ProveedoresList
          proveedores={((data ?? []) as unknown as (ProveedorFicha & { cuenta: { banco: string | null; cuenta_bancaria: string | null } | null })[]).map(
            ({ cuenta, ...p }) => ({ ...p, banco: cuenta?.banco ?? null, cuenta_bancaria: cuenta?.cuenta_bancaria ?? null }),
          )}
          tiposMaterial={tiposMaterial}
        />
        <VerMas visibles={data?.length ?? 0} limite={limite} />
      </main>
    </>
  );
}
