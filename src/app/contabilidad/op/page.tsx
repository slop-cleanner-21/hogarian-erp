import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import type { Metadata } from "next";
import Link from "next/link";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { fecha, soles } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { NuevaOrdenPago } from "./nueva-op";

export const metadata: Metadata = { title: "Órdenes de pago" };

const ESTADOS = {
  bor: "BORRADOR",
  teso: "EN_TESORERIA",
  pag: "PAGADA",
  anu: "ANULADA",
} as const;

export default async function OrdenesPagoPage({ searchParams }: PageProps<"/contabilidad/op">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const est = (typeof sp.est === "string" && sp.est in ESTADOS ? sp.est : "bor") as keyof typeof ESTADOS;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["fecha", "monto", "numero"] as const, "fecha.desc");
  const fObra = filtro(sp, "obra");
  const supabase = await createClient();

  let query = supabase
    .from("ordenes_pago")
    .select("id, numero, concepto, monto, fecha, cuenta_contable, obras(nombre), proveedores(razon_social)")
    .eq("estado", ESTADOS[est])
    .order(orden.columna, { ascending: orden.asc })
    .order("id", { ascending: false })
    .limit(limite);
  if (fObra) query = query.eq("obra_id", Number(fObra));
  if (q) {
    const like = `%${q.replace(/[%,()]/g, " ")}%`;
    query = query.or(`numero.ilike.${like},concepto.ilike.${like}`);
  }
  // Cuántas hay en cada pestaña (un circulito), con la misma obra y búsqueda.
  const contar = async (estado: string) => {
    let c = supabase.from("ordenes_pago").select("id", { count: "exact", head: true }).eq("estado", estado);
    if (fObra) c = c.eq("obra_id", Number(fObra));
    if (q) {
      const like = `%${q.replace(/[%,()]/g, " ")}%`;
      c = c.or(`numero.ilike.${like},concepto.ilike.${like}`);
    }
    return (await c).count ?? 0;
  };
  const [{ data, error }, { data: obras }, { data: proveedores }, { data: cuentas }, { data: rechazadas }, cuentasEstado] = await Promise.all([
    query,
    supabase.from("obras").select("id, nombre").order("nombre"),
    supabase.from("proveedores").select("id, ruc_o_cod, razon_social").order("razon_social"),
    supabase.from("cuentas_contables").select("codigo, denominacion").order("codigo"),
    supabase.from("rechazos").select("orden_pago_id").not("orden_pago_id", "is", null),
    Promise.all(Object.values(ESTADOS).map(contar)),
  ]);
  const cuentaDe = (e: keyof typeof ESTADOS) => cuentasEstado[Object.keys(ESTADOS).indexOf(e)];
  if (error) throw new Error(error.message);
  const conRechazo = new Set((rechazadas ?? []).map((r) => r.orden_pago_id));

  return (
    <>
      <TopBar title="Órdenes de pago" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="contabilidad-op" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-24 pt-3">
        <Tabs
          param="est"
          current={est}
          options={[
            { value: "bor", label: "Borrador", cuenta: cuentaDe("bor") },
            { value: "teso", label: "Tesorería", cuenta: cuentaDe("teso") },
            { value: "pag", label: "Pagadas", cuenta: cuentaDe("pag") },
            { value: "anu", label: "Anuladas", cuenta: cuentaDe("anu") },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder="N° o concepto" />
          </div>
          <FiltroOrden
            ordenDefault="fecha.desc"
            orden={[
              { value: "fecha.desc", label: "Fecha, más recientes" },
              { value: "fecha.asc", label: "Fecha, más antiguas" },
              { value: "monto.desc", label: "Monto, mayor a menor" },
              { value: "monto.asc", label: "Monto, menor a mayor" },
              { value: "numero.asc", label: "N° de OP" },
            ]}
            filtros={[{ param: "obra", label: "Obra", options: (obras ?? []).map((o) => ({ value: String(o.id), label: o.nombre })) }]}
          />
        </div>
        <Lista encabezado={[<Pila key="i">{["N° OP", "Beneficiario", "Concepto"]}</Pila>, <Pila key="m">{["Monto", "Fecha"]}</Pila>]}>
          {(data ?? []).map((op) => (
            <li key={op.id} className="border-b border-line last:border-0">
              <Link href={`/contabilidad/op/${op.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3 active:bg-ink/8">
                <span className="rotulo text-[22px] font-semibold leading-tight">
                  {op.numero}
                  {est === "bor" && conRechazo.has(op.id) && <span className="ml-2 font-sans text-sm font-semibold text-danger">Rechazada</span>}
                </span>
                <span className="rotulo text-right text-[21px] font-medium leading-tight">{soles(op.monto)}</span>
                <span className="truncate text-[15px]">{(op.proveedores as { razon_social: string } | null)?.razon_social}</span>
                <span className="num text-right text-sm text-ink-3">{fecha(op.fecha)}</span>
                <span className="truncate text-sm text-ink-3">{op.concepto}</span>
                {/* La numeración es por obra: la obra distingue dos OP-0002. */}
                <span className="truncate text-right text-sm text-ink-3">{(op.obras as { nombre: string } | null)?.nombre}</span>
              </Link>
            </li>
          ))}
          {!data?.length && <li className="px-4 py-10 text-center text-ink-3">Sin órdenes de pago</li>}
        </Lista>
        <VerMas visibles={data?.length ?? 0} limite={limite} />
      </main>
      {<NuevaOrdenPago obras={obras ?? []} proveedores={proveedores ?? []} cuentas={cuentas ?? []} />}
    </>
  );
}
