import { Hammer, HardHat, Package } from "lucide-react";
import { FiltroOrden } from "@/components/filtro-orden";
import { SearchBox, Tabs } from "@/components/list-controls";
import {
  PresupuestoObra,
  type PartidaAvance,
} from "@/components/presupuesto-obra";
import { EncabezadoTabla, PresupuestoTabla } from "@/components/presupuesto-tabla";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { CompartirEmpresaObra } from "@/components/compartir-empresa-obra";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { TODOS, filtro } from "@/lib/filtros";
import { matches } from "@/lib/format";
import { entregasPorPartida } from "@/lib/entregas-partida";
import { todas } from "@/lib/paginar";
import { FILTROS_PAGO, cumplePago, type FiltroPago } from "@/lib/filtro-pago";
import { pagoPorPartida } from "@/lib/pago-partida";
import { FiltrosPresupuesto } from "./filtros-presupuesto";
import { createClient, type Sesion } from "@/lib/supabase/server";
import type { Rubro } from "@/lib/types";

const RUBROS: { value: Rubro; label: string }[] = [
  { value: "MATERIAL", label: "Material" },
  { value: "MANO OBRA", label: "Mano de obra" },
  { value: "SUBCONTRATO", label: "Subcontrato" },
];

type Params = Record<string, string | string[] | undefined>;

/**
 * Pantalla "Presupuesto de obra" (Tesorería, Gerencia): elegir obra y ver su presupuesto por etapa
 * con el avance de compras y llegadas. `obras` limita las obras visibles.
 * `tabla` (Tesorería): Obra, Etapa y Rubro fijos arriba y una tabla de lo comprado frente a lo
 * presupuestado, en cantidad y monto, sin entregas.
 */
export async function PaginaPresupuesto({
  sp,
  sesion,
  clave,
  obras: soloObras,
  tabla = false,
}: {
  sp: Params;
  sesion: Sesion;
  clave: string;
  obras?: number[];
  tabla?: boolean;
}) {
  const q = typeof sp.q === "string" ? sp.q.trim().toUpperCase() : "";
  // Tesorería elige varias etapas (separadas por coma) y filtra por estado de pago.
  const etapa = tabla ? null : filtro(sp, "etapa");
  const etapasSel = tabla && typeof sp.etapa === "string" ? sp.etapa.split(",").filter((e) => e && e !== TODOS) : [];
  const pago = tabla ? ((FILTROS_PAGO.find((f) => f.value === sp.pago)?.value ?? null) as FiltroPago | null) : null;
  // Tesorería separa por pestañas Material | Mano de obra | Subcontrato (material por defecto).
  const rubroUrl = filtro(sp, "rubro") as Rubro | null;
  const rubro = tabla ? (RUBROS.some((r) => r.value === rubroUrl) ? rubroUrl! : "MATERIAL") : rubroUrl;
  const avance = tabla ? null : filtro(sp, "avance");
  const supabase = await createClient();

  let obrasQ = supabase
    .from("obras")
    .select("id, nombre, empresa_id, empresas(nombre), partidas(count)")
    .order("nombre");
  if (soloObras) obrasQ = obrasQ.in("id", soloObras.length ? soloObras : [-1]);
  const [{ data: obras, error: eObras }, { data: etapas }] = await Promise.all([
    obrasQ,
    supabase.from("etapas").select("codigo, orden").order("orden"),
  ]);
  if (eObras) throw new Error(eObras.message);
  // Solo obras con presupuesto cargado.
  const conPresupuesto = obras.filter(
    (o) => ((o.partidas as unknown as { count: number }[])[0]?.count ?? 0) > 0,
  );
  const empresas = [
    ...new Map(
      conPresupuesto.map((o) => [
        String(o.empresa_id),
        (o.empresas as unknown as { nombre: string } | null)?.nombre ?? "",
      ]),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const empresa = filtro(sp, "empresa");
  const lista = empresa
    ? conPresupuesto.filter((o) => String(o.empresa_id) === empresa)
    : conPresupuesto;
  // Si la obra elegida no es de la empresa filtrada, se toma la primera de esa empresa.
  const obraId = String(
    lista.find((o) => String(o.id) === sp.obra)?.id ?? lista[0]?.id ?? "",
  );

  const [filas, entregas, pagos, etapasObra] = await Promise.all([
    obraId
      ? todas((a, b) => {
          let query = supabase
            .from("v_avance_partida")
            .select("*")
            .eq("obra_id", Number(obraId))
            .order("partida_id")
            .range(a, b);
          if (etapa) query = query.eq("etapa", etapa);
          if (etapasSel.length) query = query.in("etapa", etapasSel);
          if (rubro) query = query.eq("rubro", rubro);
          return query;
        })
      : [],
    obraId && !tabla ? entregasPorPartida(Number(obraId)) : Promise.resolve({}),
    obraId && tabla ? pagoPorPartida(Number(obraId)) : Promise.resolve(new Map()),
    // Etapas que tiene la obra (para elegir varias).
    obraId && tabla
      ? todas((a, b) => supabase.from("partidas").select("etapa").eq("obra_id", Number(obraId)).range(a, b))
      : Promise.resolve([] as { etapa: string }[]),
  ]);
  const ordenEtapa = new Map((etapas ?? []).map((e) => [e.codigo, e.orden]));
  const partidas: PartidaAvance[] = filas
    .map((f) => ({
      id: f.partida_id!,
      etapa: f.etapa ?? "",
      requerimiento: f.requerimiento,
      descripcion: f.descripcion ?? "",
      unidad: f.unidad ?? "",
      presupuestado: Number(f.presupuestado),
      pu: Number(f.pu),
      parcial: Number(f.parcial),
      comprado: Number(f.comprado),
      montoComprado: Number(f.monto_comprado),
      llegado: Number(f.llegado),
    }))
    .filter((p) => !q || matches(p.descripcion, q))
    .filter((p) => !pago || cumplePago(pago, p.presupuestado, pagos.get(p.id)))
    .filter((p) =>
      avance === "comprar"
        ? p.comprado < p.presupuestado - 0.0001
        : avance === "llegar"
          ? p.llegado < p.comprado - 0.0001
          : avance === "completo"
            ? p.llegado >= p.presupuestado - 0.0001
            : true,
    )
    .sort(
      (a, b) =>
        (ordenEtapa.get(a.etapa) ?? 999) - (ordenEtapa.get(b.etapa) ?? 999) ||
        a.etapa.localeCompare(b.etapa),
    );

  const opcionesObra = lista.map((o) => ({
    value: String(o.id),
    label: o.nombre,
    hint: (o.empresas as unknown as { nombre: string } | null)?.nombre,
  }));

  if (tabla)
    return (
      <>
        <TopBar title="Presupuesto de obra" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
        <RecordarFiltros clave={clave} />
        <CompartirEmpresaObra />
        <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20">
          {/* Fija debajo de la barra superior (h-15 + borde): filtros, rubro, búsqueda y cabecera de la tabla. */}
          <div className="sticky top-[61px] z-10 -mx-4 flex flex-col gap-2 border-b border-line bg-bg px-4 pt-3">
            <FiltrosPresupuesto
              empresas={empresas.map(([id, nombre]) => ({ id, nombre }))}
              empresa={empresa}
              obras={opcionesObra}
              obraId={obraId}
              etapas={[...new Set(etapasObra.map((e) => e.etapa))].sort(
                (a, b) => (ordenEtapa.get(a) ?? 999) - (ordenEtapa.get(b) ?? 999) || a.localeCompare(b),
              )}
              etapasSel={etapasSel}
              pago={pago}
            />
            <Tabs
              param="rubro"
              current={rubro ?? "MATERIAL"}
              options={[
                { value: "MATERIAL", label: "Material", icon: <Package size={17} aria-hidden /> },
                { value: "MANO OBRA", label: "M. de obra", icon: <HardHat size={17} aria-hidden /> },
                { value: "SUBCONTRATO", label: "Subcontrato", icon: <Hammer size={17} aria-hidden /> },
              ]}
            />
            <SearchBox placeholder="Ítem" />
            <EncabezadoTabla />
          </div>
          <PresupuestoTabla partidas={partidas} />
        </main>
      </>
    );

  return (
    <>
      <TopBar
        title="Presupuesto de obra"
        right={
          <UserMenu
            id={sesion.userId}
            nombre={sesion.nombre}
            rol={sesion.rol}
          />
        }
      />
      <RecordarFiltros clave={clave} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <div className="grid grid-cols-[2fr_3fr] gap-2">
          <UrlSelect
            param="empresa"
            label="Empresa"
            value={empresa ?? TODOS}
            options={[
              { value: TODOS, label: "Todas" },
              ...empresas.map(([value, label]) => ({ value, label })),
            ]}
          />
          <UrlSelect
            param="obra"
            label="Obra"
            value={obraId}
            options={opcionesObra}
          />
        </div>
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
                options: (etapas ?? []).map((e) => ({
                  value: e.codigo,
                  label: e.codigo,
                })),
              },
              {
                param: "rubro",
                label: "Rubro",
                options: RUBROS,
              },
              {
                param: "avance",
                label: "Avance",
                options: [
                  { value: "comprar", label: "Falta comprar" },
                  { value: "llegar", label: "Falta que llegue" },
                  { value: "completo", label: "Todo llegó" },
                ],
              },
            ]}
          />
        </div>
        <PresupuestoObra partidas={partidas} entregas={entregas} />
      </main>
    </>
  );
}
