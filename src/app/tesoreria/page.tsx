import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { TopBar, UserMenu } from "@/components/shell";
import { desdeFecha, filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { cn, fecha, soles } from "@/lib/format";
import { todas } from "@/lib/paginar";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { hrefPago, type PorPagar } from "@/lib/tesoreria";
import type { Rol } from "@/lib/types";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { IconoTodas, LogoEmpresa } from "@/components/logo-empresa";
import { GuardarSeleccion, RetomarSeleccion } from "./seleccion";
import { EmpresaObra } from "./cabecera-pagos";
import { SelectorDiseno } from "@/components/selector-diseno";
import { FiltrosHoja } from "@/components/filtros-hoja";
import { MONTOS, RANGOS_MONTO } from "@/lib/filtros";
import { CompartirEmpresaObra } from "@/components/compartir-empresa-obra";
import { CLASE_FIJO, cookieDiseno, cookieFijar, esAgrupado, grupoDe, leerDiseno, leerFijar, ordenGrupos, totalesPorGrupo, type Agrupado, type FilaGrupo } from "@/lib/diseno";
import { TODOS } from "@/lib/filtros";
import { RotateCcw, TriangleAlert } from "lucide-react";

const SECCIONES = [
  { doc: "OC", label: "Órdenes de compra" },
  { doc: "OS", label: "Órdenes de servicio" },
  { doc: "OP", label: "Órdenes de pago" },
] as const;

/** Valor de la URL para ver todas las empresas o todas las áreas a la vez. */
const TODAS = "todas";
type Area = "log" | "con" | "todas";

export const metadata: Metadata = { title: "Pagos" };

export default async function PagosPage({ searchParams }: PageProps<"/tesoreria">) {
  const sesion = await requireSesion(["TESORERIA"]);
  const sp = await searchParams;
  const est = sp.est === "pag" || sp.est === "rec" ? sp.est : "pend";
  const pagado = est === "pag";
  const rechazos = est === "rec";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["fecha", "monto", "proveedor", "numero"] as const, pagado || rechazos ? "fecha.desc" : "fecha.asc");
  const fObraUrl = filtro(sp, "obra");
  const fProveedor = filtro(sp, "proveedor");
  // Varias etapas a la vez, separadas por coma (como en el presupuesto).
  const fEtapas = typeof sp.etapa === "string" && sp.doc !== "OP" ? sp.etapa.split(",").filter((e) => e && e !== TODOS) : [];
  // Pestañas OC | OS | OP (la de estado se conserva al cambiar). Las OP son las órdenes de pago de Contabilidad.
  const doc = sp.doc === "OS" ? "OS" : sp.doc === "OP" ? "OP" : "OC";
  const fFecha = filtro(sp, "fecha");
  const fMonto = filtro(sp, "monto");
  // Entrada: primero la empresa, luego el área que envía (Logística: OC/OS; Contabilidad: OP); en
  // las dos se puede elegir «todas».
  // Prod 1: una sola área, con las OP de Contabilidad como una pestaña más junto a OC y OS.
  const area = "log" as Area | null;
  // El monto que se ordena es el que se muestra en cada pestaña.
  const columnaMonto = pagado ? "pagado" : "saldo";
  const supabase = await createClient();

  const catalogosP = Promise.all([
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("obras").select("id, nombre, empresa_id").order("nombre"),
    supabase.from("proveedores").select("id, ruc_o_cod, razon_social").order("razon_social"),
    supabase.from("etapas").select("codigo").order("orden"),
  ]);
  const empresaId = typeof sp.empresa === "string" ? sp.empresa : "";
  const todasEmpresas = empresaId === TODAS;
  const docs = area === "log" ? [doc] : area === "con" ? ["OP"] : ["OC", "OS", "OP"];
  const like = `%${q.replace(/[%,()]/g, " ")}%`;
  // La lista, sus totales y las reenviadas, a la vez que los catálogos (no dependen de ellos; antes iban después). La
  // obra de la URL se valida al llegar las obras: si no es de la empresa (un enlace viejo), se piden de nuevo sin ella.
  // Los rechazos (pestaña aparte) filtran por el RUC del proveedor: esperan a los catálogos.
  let fObra: string | null = fObraUrl;
  const pedirLista = () =>
    Promise.all([Promise.all(docs.map((d) => (rechazos ? historialRechazos([d]) : documentos([d])))), totalesPorDoc()]);
  let listaP = empresaId && !rechazos ? pedirLista() : null;
  listaP?.catch(() => {});
  // Por pagar: las que volvieron corregidas de un rechazo (Tesorería revisa primero lo que pidió corregir).
  const reenviadasP =
    empresaId && est === "pend" ? supabase.from("rechazos").select("obra_id, numero").not("reenviado_at", "is", null) : null;

  const [{ data: empresas }, { data: obras }, { data: proveedores }, { data: etapas }] = await catalogosP;
  const empresa = todasEmpresas
    ? { id: TODAS, nombre: "Todas" }
    : (empresas ?? []).map((e) => ({ id: String(e.id), nombre: e.nombre })).find((e) => e.id === empresaId);
  if (!empresa || !area) {
    return (
      <EntradaTesoreria
        sesion={sesion}
        empresas={empresas ?? []}
        empresa={empresa ?? null}
        area={area}
        retomar={Object.keys(sp).length === 0}
      />
    );
  }
  const obrasEmpresa = (obras ?? []).filter((o) => todasEmpresas || String(o.empresa_id) === empresaId);
  // Una obra de otra empresa (enlace viejo, vista guardada) no filtra.
  const obraValida = obrasEmpresa.some((o) => String(o.id) === fObraUrl) ? fObraUrl : null;
  if (obraValida !== fObra) {
    fObra = obraValida;
    listaP = null;
  }
  // Cuántos hay en cada pestaña (un circulito), con los mismos filtros: cada estado del documento elegido, y en OC / OS /
  // OP el total del documento (por pagar + pagado + rechazos). Solo cuentan (head): no traen filas.
  const contar = async (estado: "pend" | "pag" | "rec", d: string) => {
    const { count } =
      estado === "rec"
        ? await filtrarRechazos(supabase.from("v_rechazos").select("doc", { count: "exact", head: true }).eq("doc", d))
        : await filtrarDocumentos(
            supabase.from("v_por_pagar").select("doc", { count: "exact", head: true }).eq("estado", estado === "pag" ? "PAGADO" : "PENDIENTE").eq("doc", d),
            // Las OP no tienen etapas.
            d === "OP",
          );
    return count ?? 0;
  };
  const totalDe = async (d: string) => (await Promise.all([contar("pend", d), contar("pag", d), contar("rec", d)])).reduce((a, n) => a + n, 0);
  const cuentasP = Promise.all([totalDe("OC"), totalDe("OS"), totalDe("OP"), contar("pend", doc), contar("pag", doc), contar("rec", doc)]);
  const galletas = await cookies();
  const diseno = leerDiseno(galletas.get(cookieDiseno("pagos"))?.value);
  const fijo = leerFijar(galletas.get(cookieFijar("pagos"))?.value);

  // Con varias secciones (área «Todas»), cada una trae su propia página: así ninguna queda vacía al
  // fondo ni salta al cargar más.
  // Nombre de la empresa de cada orden (los rechazos solo traen su id).
  const nombreEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.nombre]));
  // La lista y los totales a la vez (antes, uno después del otro).
  // Totales: cantidad y suma de cada sección con los mismos filtros, no solo de lo cargado; también por
  // grupo, para los diseños agrupados (por obra, proveedor, fecha, empresa o monto).
  // `filtrados`: todos los documentos filtrados (no solo los cargados), para «Por etapa».
  const [porDoc, { t: totales, filas: filtrados }] = await (listaP ?? pedirLista());
  const [nOC, nOS, nOP, nPend, nPag, nRec] = await cuentasP;
  const data = porDoc.flat();
  const visibles = Math.max(0, ...porDoc.map((f) => f.length));

  // «Por etapa»: un documento sale en cada etapa que toca. Su monto (saldo o lo pagado) se reparte entre
  // ellas según lo que pide en cada una, así las sumas por etapa cuadran con la de la sección.
  const claveDoc = (obraId: number | null, numero: string | null) => `${obraId}-${numero}`;
  const enEtapa = new Map<string, number>();
  const etapasDe = new Map<string, string[]>();
  const totalesEtapa = new Map<string, { docs: Set<string>; suma: number }>();
  if (diseno === "etapa") {
    const lineas = await todas<{ obra_id: number | null; numero_oc: string | null; etapa: string | null; parcial: number | null }>((a, b) => {
      let q = supabase.from("v_oc_items_calc").select("obra_id, numero_oc, etapa, parcial");
      if (fObra) q = q.eq("obra_id", Number(fObra));
      return q.order("id").range(a, b);
    });
    const porDocEtapa = new Map<string, Map<string, number>>();
    for (const l of lineas) {
      const k = claveDoc(l.obra_id, l.numero_oc);
      const m = porDocEtapa.get(k) ?? new Map<string, number>();
      const e = l.etapa ?? "Sin etapa";
      m.set(e, (m.get(e) ?? 0) + (Number(l.parcial) || 0));
      porDocEtapa.set(k, m);
    }
    for (const f of filtrados) {
      const k = claveDoc(f.obra_id, f.numero);
      const m = porDocEtapa.get(k) ?? new Map([["Sin etapa", 0]]);
      const total = [...m.values()].reduce((a, x) => a + x, 0);
      etapasDe.set(k, [...m.keys()]);
      for (const [e, parcial] of m) {
        const monto = total > 0 ? (f.monto * parcial) / total : f.monto / m.size;
        enEtapa.set(`${k}|${e}`, monto);
        const g = `${f.doc}-${e}`;
        const t = totalesEtapa.get(g) ?? { docs: new Set<string>(), suma: 0 };
        t.docs.add(k);
        t.suma += monto;
        totalesEtapa.set(g, t);
      }
    }
  }

  async function totalesPorDoc() {
    type Total = { doc: string | null; obra_id: number | null; numero: string | null; obra: string | null; proveedor: string | null; empresa_id: number | null; fecha: string | null; monto: number };
    const filas: Total[] = rechazos
      ? (
          await todas<{ doc: string | null; obra_id: number | null; numero: string | null; obra: string | null; proveedor: string | null; empresa_id: number | null; created_at: string | null }>((a, b) =>
            filtrarRechazos(supabase.from("v_rechazos").select("doc, obra_id, numero, obra, proveedor, empresa_id, created_at").in("doc", docs)).range(a, b),
          )
        ).map((f) => ({ ...f, fecha: f.created_at, monto: 0 }))
      : (
          await todas<{ doc: string | null; obra_id: number | null; numero: string | null; obra: string | null; proveedor: string | null; empresa_id: number | null; fecha: string | null; pagado: number | null; saldo: number | null }>((a, b) =>
            filtrarDocumentos(
              supabase.from("v_por_pagar").select("doc, obra_id, numero, obra, proveedor, empresa_id, fecha, pagado, saldo").eq("estado", pagado ? "PAGADO" : "PENDIENTE").in("doc", docs),
            ).range(a, b),
          )
        ).map((f) => ({ ...f, monto: Number(pagado ? f.pagado : f.saldo) || 0 }));
    // Los nombres de las empresas (para agrupar «Por empresa»), cuando lleguen los catálogos.
    const [{ data: emps }] = await catalogosP;
    const nombres = new Map((emps ?? []).map((e) => [e.id, e.nombre]));
    const t = new Map<string, { n: number; suma: number }>();
    for (const f of filas) {
      const x = t.get(f.doc ?? "") ?? { n: 0, suma: 0 };
      x.n += 1;
      x.suma += f.monto;
      t.set(f.doc ?? "", x);
    }
    for (const doc of docs)
      for (const [k, v] of totalesPorGrupo(
        filas.filter((f) => f.doc === doc).map((f) => ({ ...f, empresa: nombres.get(f.empresa_id ?? -1) ?? null })),
        `${doc}-`,
      ))
        t.set(k, v);
    return { t, filas };
  }

  async function documentos(docs: string[]) {
    const query = filtrarDocumentos(
      supabase
        .from("v_por_pagar")
        .select("*")
        .eq("estado", pagado ? "PAGADO" : "PENDIENTE")
        .in("doc", docs)
        .order(orden.columna === "monto" ? columnaMonto : orden.columna, { ascending: orden.asc, nullsFirst: false })
        // Desempate único: el N° se repite entre obras (sin la obra, las empatadas cambiaban de lugar con «Ver más»).
        .order("numero")
        .order("obra_id")
        .limit(limite),
    );
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mismo filtro sirve a la lista y a los totales
  function filtrarDocumentos<Q extends { eq: any; overlaps: any; gte: any; lt: any; or: any }>(query: Q, sinEtapas = false): Q {
    if (!todasEmpresas) query = query.eq("empresa_id", Number(empresaId));
    if (fObra) query = query.eq("obra_id", Number(fObra));
    if (fProveedor) query = query.eq("proveedor_id", Number(fProveedor));
    if (fEtapas.length && !sinEtapas) query = query.overlaps("etapas", fEtapas);
    const desde = desdeFecha(fFecha);
    if (desde) query = query.gte("fecha", desde[0]).lt("fecha", desde[1]);
    const rango = RANGOS_MONTO[fMonto ?? ""];
    if (rango) {
      query = query.gte(columnaMonto, rango[0]);
      if (rango[1] != null) query = query.lt(columnaMonto, rango[1]);
    }
    if (q) query = query.or(`numero.ilike.${like},proveedor.ilike.${like},ruc.ilike.${like},obra.ilike.${like}`);
    return query;
  }

  // Documentos que Tesorería devolvió, con el motivo (el detalle muestra todo su historial).
  async function historialRechazos(docs: string[]): Promise<(PorPagar & { motivo: string | null })[]> {
    const query = filtrarRechazos(
      supabase
        .from("v_rechazos")
        .select("*")
        .in("doc", docs)
        .order(orden.columna === "numero" || orden.columna === "proveedor" ? orden.columna : "created_at", { ascending: orden.asc })
        .order("created_at", { ascending: false })
        .order("id")
        .limit(limite),
    );
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data.map((r) => ({
      doc: r.doc,
      obra_id: r.obra_id,
      numero: r.numero,
      orden_pago_id: r.orden_pago_id,
      obra: r.obra,
      proveedor: r.proveedor,
      ruc: r.ruc,
      empresa: nombreEmpresa.get(r.empresa_id) ?? null,
      fecha: r.created_at,
      total: 0,
      pagado: 0,
      saldo: 0,
      falta_comprobante: false,
      motivo: r.motivo,
    })) as (PorPagar & { motivo: string | null })[];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mismo filtro sirve a la lista y a los totales
  function filtrarRechazos<Q extends { eq: any; gte: any; lt: any; or: any }>(query: Q): Q {
    if (!todasEmpresas) query = query.eq("empresa_id", Number(empresaId));
    if (fObra) query = query.eq("obra_id", Number(fObra));
    const ruc = (proveedores ?? []).find((p) => String(p.id) === fProveedor)?.ruc_o_cod;
    if (ruc) query = query.eq("ruc", ruc);
    const rango = desdeFecha(fFecha);
    // created_at es un instante: el día se cuenta en hora de Lima.
    if (rango) query = query.gte("created_at", `${rango[0]}T00:00:00-05:00`).lt("created_at", `${rango[1]}T00:00:00-05:00`);
    if (q) query = query.or(`numero.ilike.${like},proveedor.ilike.${like},ruc.ilike.${like},obra.ilike.${like}`);
    return query;
  }

  type Fila = (typeof data)[number];
  // Por pagar: las que volvieron corregidas de un rechazo (pedidas al principio, con lo demás).
  const reenviadas = new Set<string>();
  for (const x of (reenviadasP ? (await reenviadasP).data : null) ?? []) reenviadas.add(`${x.obra_id}-${x.numero}`);
  const reenviada = (f: { doc: string | null; obra_id: number | null; numero: string | null }) =>
    f.doc !== "OP" && reenviadas.has(`${f.obra_id}-${f.numero}`);
  const MarcaReenviada = ({ f }: { f: Fila }) =>
    reenviada(f) ? (
      <span className="ml-2 inline-block rounded-full bg-ok-bg px-2 align-middle text-[13px] font-semibold leading-5 text-ok">Reenviada</span>
    ) : null;
  const IconoReenviada = ({ f }: { f: Fila }) =>
    reenviada(f) ? <RotateCcw size={15} role="img" aria-label="Reenviada" className="shrink-0 text-ok" /> : null;
  const clave = (f: Fila) => `${f.doc}-${f.obra_id}-${f.numero}-${f.fecha}`;
  const monto = (f: Fila) => (rechazos ? fecha(f.fecha) : soles(pagado ? f.pagado : f.saldo));
  const motivo = (f: Fila) => (f as { motivo?: string | null }).motivo ?? "Sin motivo";

  // Con una obra elegida arriba, repetirla en cada fila sobra.
  const conObra = !fObra;

  /** Fila de la lista (diseños Lista y Por obra; en Por obra la obra ya va en el grupo). */
  const fila = (f: Fila, mostrarObra = conObra) => (
    <li key={clave(f)} className="border-b border-line last:border-0">
      <Link prefetch={false} href={hrefPago(f)} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3 active:bg-ink/8">
        <span className="rotulo text-[22px] font-semibold leading-tight">
          {f.numero}
          <MarcaReenviada f={f} />
        </span>
        <span className="rotulo text-right text-[21px] font-medium leading-tight">{monto(f)}</span>
        <span className="truncate text-[15px]">{f.proveedor}</span>
        <span className="num truncate text-right text-sm text-ink-3">{rechazos ? "" : fecha(f.fecha)}</span>
        {mostrarObra ? <span className="truncate text-sm text-ink-3">{f.obra}</span> : <span />}
        {rechazos ? (
          <span />
        ) : est === "pend" && f.falta_guia ? (
          <span className="text-right text-sm font-semibold text-warn">Falta guía</span>
        ) : est === "pend" && Number(f.pagado) > 0 ? (
          <span className="num text-right text-sm text-ink-3">de {soles(f.total)}</span>
        ) : (
          <span />
        )}
        {rechazos && (
          <span className="col-span-2 mt-1.5 rounded-field bg-danger/10 px-3 py-2 text-[15px] text-danger">{motivo(f)}</span>
        )}
      </Link>
    </li>
  );

  /** Fila de una línea: N°, proveedor (u obra, en Por proveedor) y monto; la fecha queda en el detalle. */
  const filaCompacta = (f: Fila, texto: string | null = f.proveedor) => (
    <li key={clave(f)} className="border-b border-line last:border-0">
      <Link
        prefetch={false}
        href={hrefPago(f)}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 active:bg-ink/8"
      >
        <span className="rotulo text-[18px] font-semibold leading-tight">{f.numero}</span>
        <span className="truncate text-[15px]">{texto}</span>
        <span className="num flex items-center justify-end gap-1 text-right text-[16px] font-semibold">
          <IconoReenviada f={f} />
          {est === "pend" && f.falta_guia && (
            <TriangleAlert size={15} role="img" aria-label="Falta guía" className="shrink-0 text-warn" />
          )}
          {monto(f)}
        </span>
        {rechazos && <span className="col-span-3 truncate text-[14px] text-danger">{motivo(f)}</span>}
      </Link>
    </li>
  );

  /** Tarjeta por orden: proveedor y monto grandes; lo pagado de lo total, si hay pago parcial. */
  const tarjeta = (f: Fila) => {
    const parcial = est === "pend" && Number(f.pagado) > 0 && Number(f.total) > 0;
    return (
      <li key={clave(f)}>
        <Link prefetch={false} href={hrefPago(f)} className="flex flex-col gap-1.5 rounded-panel bg-surface px-4 py-3 active:bg-sunken">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-[16px] font-semibold leading-snug [overflow-wrap:anywhere]">{f.proveedor}</span>
            <span className="rotulo shrink-0 text-right text-[24px] font-semibold leading-none">{monto(f)}</span>
          </span>
          <span className="flex justify-between gap-3 text-sm text-ink-3">
            <span className="truncate">
              <span className="rotulo text-[16px] font-semibold text-ink-2">{f.numero}</span>
              {conObra && ` · ${f.obra}`}
            </span>
            {!rechazos && <span className="num shrink-0">{fecha(f.fecha)}</span>}
          </span>
          {parcial && (
            <span className="flex flex-col gap-1">
              <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (Number(f.pagado) / Number(f.total)) * 100)}%` }} />
              </span>
              <span className="num text-sm text-ink-3">
                Pagado {soles(f.pagado)} de {soles(f.total)}
              </span>
            </span>
          )}
          {est === "pend" && f.falta_guia && (
            <span className="self-start rounded-full bg-warn-bg px-2.5 py-0.5 text-sm font-semibold text-warn">Falta guía</span>
          )}
          {reenviada(f) && <span className="self-start rounded-full bg-ok-bg px-2.5 py-0.5 text-sm font-semibold text-ok">Reenviada</span>}
          {rechazos && <span className="rounded-field bg-danger/10 px-3 py-2 text-[15px] text-danger">{motivo(f)}</span>}
        </Link>
      </li>
    );
  };

  /** «Por etapa», en el orden de las etapas: cada documento con su parte en la etapa (y su monto, si toca varias). */
  const vistaPorEtapa = (doc: string, filas: Fila[]) => {
    const posicion = new Map((etapas ?? []).map((e, i) => [e.codigo, i]));
    const g = new Map<string, Fila[]>();
    for (const f of filas) for (const e of etapasDe.get(claveDoc(f.obra_id, f.numero)) ?? ["Sin etapa"]) g.set(e, [...(g.get(e) ?? []), f]);
    return [...g.keys()]
      .sort((a, b) => (posicion.get(a) ?? 999) - (posicion.get(b) ?? 999) || a.localeCompare(b))
      .map((e) => {
        const fs = g.get(e)!;
        const t = totalesEtapa.get(`${doc}-${e}`);
        return (
          <div key={e} className="pb-3">
            <h3 className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
              <span className="flex min-w-0 items-baseline text-[16px] font-semibold">
                <span className="rotulo truncate text-[19px]">{e}</span>{" "}
                <span className="num shrink-0 pl-1 font-normal text-ink-3">{t?.docs.size ?? fs.length}</span>
              </span>
              {!rechazos && <span className="num shrink-0 text-[15px] text-ink-2">{soles(t?.suma ?? 0)}</span>}
            </h3>
            <ul className="overflow-hidden rounded-panel bg-surface">
              {fs.map((f) => {
                const k = claveDoc(f.obra_id, f.numero);
                const varias = (etapasDe.get(k)?.length ?? 0) > 1;
                return (
                  <li key={`${clave(f)}-${e}`} className="border-b border-line last:border-0">
                    <Link
                      prefetch={false}
                      href={hrefPago(f)}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 active:bg-ink/8"
                    >
                      <span className="rotulo text-[18px] font-semibold leading-tight">{f.numero}</span>
                      <span className="truncate text-[15px]">{f.proveedor}</span>
                      <span className="num flex items-center justify-end gap-1 text-right text-[16px] font-semibold">
                        <IconoReenviada f={f} />
                        {est === "pend" && f.falta_guia && (
                          <TriangleAlert size={15} role="img" aria-label="Falta guía" className="shrink-0 text-warn" />
                        )}
                        {rechazos ? fecha(f.fecha) : soles(enEtapa.get(`${k}|${e}`) ?? 0)}
                      </span>
                      <span className="num col-span-2 truncate text-[13px] text-ink-3">{rechazos ? motivo(f) : fecha(f.fecha)}</span>
                      <span className="num text-right text-[13px] text-ink-3">{varias && !rechazos ? `de ${monto(f)}` : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      });
  };

  const filaGrupo = (f: Fila): FilaGrupo => ({
    obra_id: f.obra_id,
    obra: f.obra,
    proveedor: f.proveedor,
    empresa: f.empresa,
    fecha: f.fecha,
    monto: rechazos ? 0 : Number(pagado ? f.pagado : f.saldo) || 0,
  });

  /**
   * Diseños agrupados (por obra, proveedor, fecha, empresa o monto): un grupo por valor, en el orden en que
   * aparecen (por monto, del mayor al menor), con su cantidad y su suma (de todo lo filtrado).
   */
  const agrupado = (doc: string, filas: Fila[], por: Agrupado) => {
    const grupos = new Map<string, { titulo: string; filas: Fila[] }>();
    for (const f of filas) {
      const { clave, titulo } = grupoDe(por, filaGrupo(f));
      grupos.set(clave, { titulo, filas: [...(grupos.get(clave)?.filas ?? []), f] });
    }
    return ordenGrupos(por, [...grupos.keys()]).map((k) => {
      const { titulo, filas: fs } = grupos.get(k)!;
      const t = totales.get(`${doc}-${k}`) ?? { n: fs.length, suma: 0 };
      return (
        <div key={k} className="pb-3">
          <h3 className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
            {/* La cantidad queda a la vista aunque el nombre se corte. */}
            <span className="flex min-w-0 items-baseline text-[16px] font-semibold">
              <span className="truncate">{titulo}</span>{" "}
              <span className="num shrink-0 pl-1 font-normal text-ink-3">{t.n}</span>
            </span>
            {!rechazos && <span className="num shrink-0 text-[15px] text-ink-2">{soles(t.suma)}</span>}
          </h3>
          <ul className="overflow-hidden rounded-panel bg-surface">
            {fs.map((f) =>
              por === "obra"
                ? fila(f, false)
                : filaCompacta(f, por === "proveedor" ? (conObra ? f.obra : rechazos ? motivo(f) : fecha(f.fecha)) : f.proveedor),
            )}
          </ul>
        </div>
      );
    });
  };

  // Tabla: columnas fijas, también en la cabecera.
  // Sin fecha (está en «Lista»): a 360 px el proveedor necesita el espacio.
  const COLS_TABLA = "grid grid-cols-[4.5rem_minmax(0,1fr)_5.75rem] items-baseline gap-x-2 px-3";
  const tabla = (filas: Fila[]) => (
    <div className="overflow-hidden rounded-panel bg-surface">
      <div aria-hidden className={cn(COLS_TABLA, "border-b border-line bg-sunken/60 py-2 text-[13px] font-medium text-ink-2")}>
        <span>N°</span>
        <span>Proveedor</span>
        <span className="text-right">{rechazos ? "Rechazo" : pagado ? "Pagado" : "Saldo"}</span>
      </div>
      <ul>
        {filas.map((f) => (
          <li key={clave(f)} className="border-b border-line last:border-0">
            <Link prefetch={false} href={hrefPago(f)} className={cn(COLS_TABLA, "py-2 text-[14px] active:bg-ink/8")}>
              <span className="rotulo truncate text-[16px] font-semibold">{f.numero}</span>
              <span className="truncate">{f.proveedor}</span>
              <span className={cn("num flex items-center justify-end gap-1 text-right font-semibold", est === "pend" && f.falta_guia && "text-warn")}>
                <IconoReenviada f={f} />
                {monto(f)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  /** Mosaico: dos columnas de tarjetas chicas. */
  const mosaico = (filas: Fila[]) => (
    <ul className="grid grid-cols-2 gap-2">
      {filas.map((f) => (
        <li key={clave(f)}>
          <Link prefetch={false} href={hrefPago(f)} className="flex h-full flex-col gap-1 rounded-panel bg-surface p-3 active:bg-sunken">
            <span className="rotulo text-[18px] font-semibold leading-tight">{f.numero}</span>
            <span className="rotulo text-[20px] font-medium leading-tight">{monto(f)}</span>
            <span className="line-clamp-2 text-[14px] leading-snug">{f.proveedor}</span>
            <span className="mt-auto flex items-center justify-between gap-1 text-[13px] text-ink-3">
              <span className="num">{rechazos ? "" : fecha(f.fecha)}</span>
              {est === "pend" && f.falta_guia ? (
                <span className="font-semibold text-warn">Falta guía</span>
              ) : (
                reenviada(f) && <span className="font-semibold text-ok">Reenviada</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <TopBar
        title="Pagos"
        right={
          <>
            <SelectorDiseno pantalla="pagos" actual={diseno} fijo={fijo} />
            <UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />
          </>
        }
      />
      <RecordarFiltros clave={`tesoreria-${empresaId}-${area}`} base={["empresa", "area"]} />
      <GuardarSeleccion empresa={empresaId} area={area} />
      <CompartirEmpresaObra />
      <main className={cn("mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20", !fijo && "pt-3")}>
        {/* Filtros, pestañas y buscador; con «Fijar filtros arriba» quedan bajo la barra al desplazar. */}
        <div className={fijo ? CLASE_FIJO : "contents"}>
        <div className="flex flex-wrap gap-2">
          <EmpresaObra
            empresas={(empresas ?? []).map((e) => ({ id: String(e.id), nombre: e.nombre }))}
            empresa={todasEmpresas ? TODAS : empresaId}
            obras={[
              { value: TODOS, label: "Todas las obras" },
              ...obrasEmpresa.map((o) => ({ value: String(o.id), label: o.nombre })),
            ]}
            obra={fObra ?? TODOS}
          />
          <FiltrosHoja
            secciones={[
              {
                tipo: "opciones",
                param: "orden",
                titulo: "Ordenar por",
                def: pagado || rechazos ? "fecha.desc" : "fecha.asc",
                opciones: [
                  { value: "fecha.asc", label: "Más antiguos" },
                  { value: "fecha.desc", label: "Más recientes" },
                  ...(rechazos
                    ? []
                    : [
                        { value: "monto.desc", label: "Mayor monto" },
                        { value: "monto.asc", label: "Menor monto" },
                      ]),
                  { value: "proveedor.asc", label: "Proveedor, A a Z" },
                  { value: "numero.asc", label: "N° de documento" },
                ],
              },
              { tipo: "fecha", param: "fecha", titulo: rechazos ? "Fecha del rechazo" : "Fecha" },
              ...(rechazos
                ? []
                : [
                    {
                      tipo: "opciones" as const,
                      param: "monto",
                      titulo: "Monto",
                      opciones: [{ value: TODOS, label: "Todos" }, ...MONTOS],
                    },
                  ]),
              {
                tipo: "lista",
                param: "proveedor",
                titulo: doc === "OP" ? "Beneficiario" : "Proveedor",
                opciones: (proveedores ?? []).map((p) => ({ value: String(p.id), label: p.razon_social, hint: p.ruc_o_cod })),
              },
              ...(area === "log" && !rechazos && doc !== "OP"
                ? [{ tipo: "varias" as const, param: "etapa", titulo: "Etapas", opciones: (etapas ?? []).map((e) => e.codigo) }]
                : []),
            ]}
          />
        </div>
        {area === "log" && (
          <Tabs
            param="doc"
            current={doc}
            options={[
              { value: "OC", label: "OC", cuenta: nOC },
              { value: "OS", label: "OS", cuenta: nOS },
              { value: "OP", label: "OP", cuenta: nOP },
            ]}
          />
        )}
        <Tabs
          param="est"
          current={est}
          options={[
            { value: "pend", label: "Por pagar", cuenta: nPend },
            { value: "pag", label: "Pagado", cuenta: nPag },
            { value: "rec", label: "Rechazos", cuenta: nRec },
          ]}
        />
        <SearchBox placeholder="N°, proveedor, RUC u obra" />
        </div>

        {SECCIONES.map(({ doc, label }) => {
          const filas = data.filter((d) => d.doc === doc);
          if (filas.length === 0) return null;
          const { n, suma } = totales.get(doc) ?? { n: filas.length, suma: 0 };
          return (
            <section key={doc} aria-label={label}>
              <h2 className="flex items-baseline justify-between px-1 pb-1.5 pt-2">
                <span className="rotulo text-[21px] font-semibold">
                  {doc} <span className="text-ink-3">{n}</span>
                </span>
                {!rechazos && <span className="rotulo text-[19px] font-medium text-ink-2">{soles(suma)}</span>}
              </h2>
              {diseno === "etapa" ? (
                vistaPorEtapa(doc, filas)
              ) : esAgrupado(diseno) ? (
                agrupado(doc, filas, diseno)
              ) : diseno === "tabla" ? (
                tabla(filas)
              ) : diseno === "mosaico" ? (
                mosaico(filas)
              ) : diseno === "tarjetas" ? (
                <ul className="flex flex-col gap-2">{filas.map(tarjeta)}</ul>
              ) : diseno === "compacta" ? (
                <Lista encabezadoFijo={!fijo} encabezado={["N° · Proveedor", rechazos ? "Rechazo" : pagado ? "Pagado" : "Saldo"]}>
                  {filas.map((f) => filaCompacta(f))}
                </Lista>
              ) : (
                <Lista
                  encabezadoFijo={!fijo}
                  encabezado={[
                    <Pila key="i">{conObra ? ["N° documento", "Proveedor", "Obra"] : ["N° documento", "Proveedor"]}</Pila>,
                    rechazos ? "Rechazo" : <Pila key="d">{[pagado ? "Pagado" : "Saldo", "Fecha"]}</Pila>,
                  ]}
                >
                  {filas.map((f) => fila(f))}
                </Lista>
              )}
            </section>
          );
        })}
        {data.length === 0 && (
          <p className="py-10 text-center text-ink-3">{rechazos ? "Sin rechazos" : pagado ? "Sin pagos" : "Nada por pagar"}</p>
        )}
        <VerMas visibles={visibles} limite={limite} />
      </main>
    </>
  );
}

/** Entrada de Tesorería: elegir empresa y luego quién envía los documentos. */
function EntradaTesoreria({
  sesion,
  empresas,
  empresa,
  area,
  retomar,
}: {
  sesion: { userId: string; nombre: string; rol: Rol };
  empresas: { id: number; nombre: string }[];
  empresa: { id: string; nombre: string } | null;
  /** Al cambiar de empresa desde una bandeja: se vuelve a la misma área. */
  area: Area | null;
  /** Se entró sin parámetros: se vuelve a la última empresa y área elegidas. */
  retomar: boolean;
}) {
  return (
    <>
      <TopBar
        title={empresa ? empresa.nombre : "Pagos"}
        back={empresa ? "/tesoreria?area=" : undefined}
        right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />}
      />
      {retomar && !empresa && <RetomarSeleccion />}
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        {empresa ? (
          <>
            <Link
              href={`/tesoreria?empresa=${empresa.id}&area=log`}
              className="flex min-h-20 flex-col justify-center rounded-panel bg-surface px-5 active:bg-sunken"
            >
              <span className="rotulo text-[24px] font-semibold">Logística · OC / OS</span>
            </Link>
            <Link
              href={`/tesoreria?empresa=${empresa.id}&area=con`}
              className="flex min-h-20 flex-col justify-center rounded-panel bg-surface px-5 active:bg-sunken"
            >
              <span className="rotulo text-[24px] font-semibold">Contabilidad · OP</span>
            </Link>
            <Link
              href={`/tesoreria?empresa=${empresa.id}&area=${TODAS}`}
              className="flex min-h-20 flex-col justify-center rounded-panel bg-surface px-5 active:bg-sunken"
            >
              <span className="rotulo text-[24px] font-semibold">Todas · OC / OS / OP</span>
            </Link>
          </>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {empresas.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/tesoreria?empresa=${e.id}${area ? `&area=${area}` : ""}`}
                  className="flex flex-col items-center gap-2 rounded-panel bg-surface p-3 text-[17px] font-semibold active:bg-sunken"
                >
                  <LogoEmpresa nombre={e.nombre} className="h-24 w-full" />
                  {e.nombre}
                </Link>
              </li>
            ))}
            <li className="col-span-2">
              <Link
                href={`/tesoreria?empresa=${TODAS}${area ? `&area=${area}` : ""}`}
                className="flex min-h-16 items-center justify-center gap-3 rounded-panel bg-surface p-3 text-[17px] font-semibold active:bg-sunken"
              >
                <IconoTodas className="h-10 w-12" />
                Todas
              </Link>
            </li>
          </ul>
        )}
      </main>
    </>
  );
}
