import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { soles } from "@/lib/format";
import { periodoLabel, rangoPeriodos } from "@/lib/periodos";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { TIPO_COMPROBANTE_LABEL, type VRegistroCompra } from "@/lib/types";
import { FiltroOrden } from "@/components/filtro-orden";
import { filtro, ordenDe } from "@/lib/filtros";
import { ComprasList } from "./compras-list";
import { DescargasCompras } from "./descargas";
import { AccionesPeriodo } from "./acciones-periodo";
import { RecordarFiltros } from "@/components/recordar-filtros";

export const metadata: Metadata = { title: "Compras" };

export default async function ComprasPage({
  searchParams,
}: PageProps<"/contabilidad/compras">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: empresas }, { data: ultimo }, { data: primero }] =
    await Promise.all([
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase
        .from("v_registro_compras")
        .select("periodo")
        .order("periodo", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("v_registro_compras")
        .select("periodo")
        .order("periodo")
        .limit(1)
        .maybeSingle(),
    ]);
  const periodos = rangoPeriodos(
    primero?.periodo ?? null,
    ultimo?.periodo ?? null,
  );
  const empresaId = String(sp.empresa ?? empresas?.[0]?.id ?? "");
  const periodo =
    typeof sp.periodo === "string" ? sp.periodo : (periodos[0] ?? "");

  const { data, error } = await supabase
    .from("v_registro_compras")
    .select("*")
    .eq("empresa_id", Number(empresaId))
    .eq("periodo", periodo)
    .order("fecha_emision")
    .order("comprobante_id");
  if (error) throw new Error(error.message);
  const todasFilas: VRegistroCompra[] = data;
  const { data: exp, error: eExp } = await supabase
    .from("v_expediente")
    .select("comprobante_id, docs_ok, docs_req, requiere_guia, tiene_guia, requiere_contrato, tiene_contrato")
    .eq("empresa_id", Number(empresaId))
    .eq("periodo", periodo);
  if (eExp) throw new Error(eExp.message);
  const expediente = Object.fromEntries(
    exp.map((e) => [
      e.comprobante_id!,
      {
        ok: e.docs_ok ?? 0,
        req: e.docs_req ?? 0,
        guia: e.requiere_guia ? !!e.tiene_guia : null,
        contrato: e.requiere_contrato ? !!e.tiene_contrato : null,
      },
    ]),
  );

  const fEstado = filtro(sp, "estado");
  const { data: cerradoP } = periodo
    ? await supabase.rpc("periodo_cerrado", { p_empresa_id: Number(empresaId), p_periodo: periodo })
    : { data: false };
  const cerrado = cerradoP === true;
  const fExp = filtro(sp, "exp");
  const fTipo = filtro(sp, "tipo");
  const orden = ordenDe(
    sp,
    ["fecha", "total", "proveedor", "comprobante"] as const,
    "fecha.asc",
  );
  const dir = orden.asc ? 1 : -1;
  const filas = todasFilas
    .filter((f) => {
      const sinCuenta = (f.items_sin_cuenta ?? 0) > 0;
      if (fEstado === "cont" && !f.asiento_id) return false;
      if (fEstado === "pend" && (f.asiento_id || sinCuenta)) return false;
      if (fEstado === "sin" && (f.asiento_id || !sinCuenta)) return false;
      const e = expediente[f.comprobante_id];
      const completo = e && e.ok >= e.req;
      if (fExp === "completo" && !completo) return false;
      if (fExp === "incompleto" && completo) return false;
      if (fTipo && f.tipo !== fTipo) return false;
      return true;
    })
    .sort((a, b) => {
      switch (orden.columna) {
        case "total":
          return dir * (Number(a.total) - Number(b.total));
        case "proveedor":
          return dir * a.proveedor.localeCompare(b.proveedor);
        case "comprobante":
          return (
            dir *
            `${a.serie}-${a.numero}`.localeCompare(
              `${b.serie}-${b.numero}`,
              undefined,
              { numeric: true },
            )
          );
        default:
          return dir * a.fecha_emision.localeCompare(b.fecha_emision);
      }
    });
  // Totales del Registro de Compras: solo factura y boleta (los RxH no van al SIRE).
  // Lo de la lista, tal cual (también los recibos por honorarios: antes no entraban y el total no cuadraba con las filas).
  const tot = filas
    .reduce(
      (a, f) => ({
        base: a.base + Number(f.base),
        igv: a.igv + Number(f.igv),
        total: a.total + Number(f.total),
      }),
      { base: 0, igv: 0, total: 0 },
    );

  return (
    <>
      <TopBar
        title="Compras"
        right={
          <>
            <DescargasCompras
              key={`${empresaId}-${periodo}`}
              empresaId={empresaId}
              periodo={periodo}
              filas={filas.map((f) => ({
                id: f.comprobante_id,
                proveedor: f.proveedor,
                comprobante: `${TIPO_COMPROBANTE_LABEL[f.tipo as keyof typeof TIPO_COMPROBANTE_LABEL] ?? f.tipo} ${f.serie}-${f.numero}`,
                total: Number(f.total),
                ple: f.tipo === "FACTURA" || f.tipo === "BOLETA",
              }))}
            />
            <UserMenu
              id={sesion.userId}
              nombre={sesion.nombre}
              rol={sesion.rol}
            />
          </>
        }
      />
      <RecordarFiltros clave="compras" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <UrlSelect
              param="empresa"
              label="Empresa"
              value={empresaId}
              options={(empresas ?? []).map((e) => ({
                value: String(e.id),
                label: e.nombre,
              }))}
            />
          </div>
          <div className="min-w-0 flex-1">
            <UrlSelect
              param="periodo"
              label="Periodo"
              value={periodo}
              options={periodos.map((p) => ({
                value: p,
                label: periodoLabel(p),
              }))}
            />
          </div>
          <FiltroOrden
            ordenDefault="fecha.asc"
            orden={[
              { value: "fecha.asc", label: "Emisión, más antiguos" },
              { value: "fecha.desc", label: "Emisión, más recientes" },
              { value: "total.desc", label: "Total, mayor a menor" },
              { value: "total.asc", label: "Total, menor a mayor" },
              { value: "proveedor.asc", label: "Proveedor, A a Z" },
              { value: "comprobante.asc", label: "Serie y número" },
            ]}
            filtros={[
              {
                param: "estado",
                label: "Estado contable",
                options: [
                  { value: "pend", label: "Por contabilizar" },
                  { value: "sin", label: "Con ítems sin cuenta" },
                  { value: "cont", label: "Contabilizado" },
                ],
              },
              {
                param: "exp",
                label: "Expediente",
                options: [
                  { value: "incompleto", label: "Incompleto" },
                  { value: "completo", label: "Completo" },
                ],
              },
              {
                param: "tipo",
                label: "Tipo de comprobante",
                options: Object.entries(TIPO_COMPROBANTE_LABEL).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
            ]}
          />
        </div>
        {periodo && (
          <AccionesPeriodo
            empresaId={Number(empresaId)}
            periodo={periodo}
            cerrado={cerrado}
            // Lo que se puede contabilizar: sin asiento y con todos sus ítems con cuenta (de lo listado).
            porContabilizar={filas.filter((f) => !f.asiento_id && (f.items_sin_cuenta ?? 0) === 0).map((f) => f.comprobante_id)}
          />
        )}
        <ComprasList filas={filas} expediente={expediente} />
        {filas.length > 0 && (
          <section className="num grid grid-cols-3 gap-2 rounded-panel bg-surface p-4 text-right">
            <div>
              <div className="text-[13px] text-ink-2">Base</div>
              <div className="font-medium">{soles(tot.base)}</div>
            </div>
            <div>
              <div className="text-[13px] text-ink-2">IGV</div>
              <div className="font-medium">{soles(tot.igv)}</div>
            </div>
            <div>
              <div className="text-[13px] text-ink-2">Total</div>
              <div className="font-semibold">{soles(tot.total)}</div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
