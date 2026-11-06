import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { FiltrosHoja } from "@/components/filtros-hoja";
import { UrlSelect } from "@/components/url-select";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { TopBar, UserMenu } from "@/components/shell";
import { ButtonLink } from "@/components/ui/button";
import { MONTOS, RANGOS_MONTO, TODOS, desdeFecha, filtro, limite as limiteDe, ordenDe } from "@/lib/filtros";
import { cn, fecha, soles } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { ESTADO_LABEL, type EstadoOC } from "@/lib/types";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { SelectorDiseno } from "@/components/selector-diseno";
import { CLASE_FIJO, cookieDiseno, cookieFijar, esAgrupado, grupoDe, leerDiseno, leerFijar, ordenGrupos, totalesPorGrupo } from "@/lib/diseno";
import { todas } from "@/lib/paginar";

// Pendientes: lo que espera una acción de Logística (cotizar, facturar, enviar, constancia, entrega).
// Una pestaña por estado. «Enviada» (EN_ENTREGA): ya se envió la constancia de pago al proveedor (prod 1 aún no
// registra lo que llega). «Recibida»: las del Excel (y del MVP) con su entrega registrada. «Anulada».
const TABS = {
  cot: ["EMITIDA"],
  prec: ["PRECIOS_CONFIRMADOS"],
  fact: ["FACTURADA"],
  teso: ["EN_TESORERIA"],
  pag: ["PAGADA"],
  ent: ["EN_ENTREGA"],
  rec: ["RECIBIDA"],
  anu: ["ANULADA"],
  todas: null,
} satisfies Record<string, EstadoOC[] | null>;
const PESTANAS: Record<keyof typeof TABS, string> = {
  cot: "Cotizando",
  prec: "Facturar",
  // Lo que les falta para ir a Tesorería: la guía (OC) o el contrato firmado (OS); con eso van solas.
  fact: "Guía",
  teso: "Tesorería",
  pag: "Pagada",
  ent: "Enviada",
  rec: "Recibida",
  anu: "Anulada",
  todas: "Todas",
};

const ORDEN = [
  { value: "fecha.desc", label: "Más recientes" },
  { value: "fecha.asc", label: "Más antiguas" },
  { value: "total.desc", label: "Mayor total" },
  { value: "total.asc", label: "Menor total" },
  { value: "numero.desc", label: "N° descendente" },
  { value: "numero.asc", label: "N° ascendente" },
  { value: "proveedor.asc", label: "Proveedor, A a Z" },
];

export async function generateMetadata({ searchParams }: PageProps<"/logistica">): Promise<Metadata> {
  return { title: (await searchParams).tipo === "OS" ? "Órdenes de servicio" : "Órdenes de compra" };
}

export default async function OrdenesPage({ searchParams }: PageProps<"/logistica">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  const sp = await searchParams;
  const tipo = sp.tipo === "OS" ? "OS" : "OC";
  const tab = (typeof sp.tab === "string" && sp.tab in TABS ? sp.tab : "cot") as keyof typeof TABS;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const limite = limiteDe(sp);
  const orden = ordenDe(sp, ["fecha", "total", "numero", "proveedor"] as const, "fecha.desc");
  const obra = filtro(sp, "obra");
  const proveedor = filtro(sp, "proveedor");
  const alerta = filtro(sp, "alerta");
  const estado = filtro(sp, "estado") as EstadoOC | null;
  // Varias etapas y tipos de material a la vez (separados por coma), como en Tesorería.
  const varias = (p: string) => (typeof sp[p] === "string" ? (sp[p] as string).split(",").filter((e) => e && e !== TODOS) : []);
  const etapasSel = varias("etapa");
  const materiales = varias("material");
  const rangoMonto = RANGOS_MONTO[filtro(sp, "monto") ?? ""];
  const rangoFecha = desdeFecha(filtro(sp, "fecha"));

  const galletas = await cookies();
  const diseno = leerDiseno(galletas.get(cookieDiseno("logistica"))?.value, "logistica");
  const fijo = leerFijar(galletas.get(cookieFijar("logistica"))?.value);
  const agrupado = esAgrupado(diseno) ? diseno : null;
  // «Por etapa»: una orden aparece en cada etapa que toca, con lo que pide en ella.
  const porEtapa = diseno === "etapa";

  const supabase = await createClient();
  const estados = TABS[tab];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el mismo filtro sirve a la lista y a los totales por grupo
  const filtrar = <Q extends { eq: any; in: any; overlaps: any; gte: any; lt: any; or: any }>(query: Q): Q => {
    query = query.eq("tipo", tipo);
    if (estados) query = query.in("estado", estados);
    if (obra) query = query.eq("obra_id", Number(obra));
    if (proveedor) query = query.eq("proveedor_id", Number(proveedor));
    if (alerta) query = query.eq("has_alertas", alerta === "si");
    if (estado && estado in ESTADO_LABEL) query = query.eq("estado", estado);
    if (etapasSel.length) query = query.overlaps("etapas", etapasSel);
    if (materiales.length) query = query.overlaps("tipos_material", materiales);
    if (rangoMonto) {
      query = query.gte("total", rangoMonto[0]);
      if (rangoMonto[1] != null) query = query.lt("total", rangoMonto[1]);
    }
    if (rangoFecha) query = query.gte("fecha", rangoFecha[0]).lt("fecha", rangoFecha[1]);
    if (q) {
      const limpio = q.replace(/[%,()]/g, " ");
      const like = `%${limpio}%`;
      // Los ítems, sin tildes y con las palabras en orden pero no seguidas: «cemento sol» halla «CEMENTO PORTLAND SOL».
      const item = `%${limpio.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, "%")}%`;
      query = query.or(`numero.ilike.${like},proveedor.ilike.${like},obra.ilike.${like},items_busqueda.ilike.${item}`);
    }
    return query;
  };
  const query = filtrar(
    supabase
      .from("v_ordenes")
      .select("obra_id, numero, obra, proveedor, empresa, fecha, estado, total, has_alertas")
      .order(orden.columna, { ascending: orden.asc, nullsFirst: false })
      .order("created_at", { ascending: false })
      // Desempate único (las del Excel se cargaron a la vez: comparten fecha y alta): sin él, las empatadas salían en
      // cualquier orden y cambiaban de lugar entre cargas y con «Ver más».
      .order("obra_id")
      .order("numero")
      .limit(limite),
  );
  const [{ data: ordenes, error }, { data: obras }, { data: proveedores }, { data: etapas }, { data: tipos }, grupos] = await Promise.all([
    query,
    // Por páginas: la API corta cada respuesta en 1000 filas.
    todas((a, b) => supabase.from("obras").select("id, nombre").order("nombre").order("id").range(a, b)).then((data) => ({ data })),
    todas((a, b) => supabase.from("proveedores").select("id, razon_social, ruc_o_cod").order("razon_social").order("id").range(a, b)).then((data) => ({ data })),
    supabase.from("etapas").select("codigo").order("orden"),
    supabase.from("tipos_material").select("codigo").order("orden"),
    // Diseños agrupados: cantidad y suma de cada grupo, de todo lo filtrado (no solo lo cargado).
    agrupado || porEtapa
      ? todas<{ obra_id: number | null; numero: string | null; obra: string | null; proveedor: string | null; empresa: string | null; fecha: string | null; total: number | null }>(
          (a, b) => filtrar(supabase.from("v_ordenes").select("obra_id, numero, obra, proveedor, empresa, fecha, total")).range(a, b),
        )
      : Promise.resolve([]),
  ]);
  const totalesGrupo = totalesPorGrupo(grupos.map((g) => ({ ...g, monto: Number(g.total) || 0 })));

  // Por etapa: lo que pide cada orden filtrada en cada etapa, y por etapa cuántas órdenes y cuánto suman.
  const claveOrden = (obraId: number | null, numero: string | null) => `${obraId}-${numero}`;
  const filtradas = new Set(grupos.map((g) => claveOrden(g.obra_id, g.numero)));
  const enEtapa = new Map<string, number>();
  const etapasDeOrden = new Map<string, string[]>();
  const totalesEtapa = new Map<string, { ordenes: Set<string>; suma: number }>();
  if (porEtapa) {
    const lineas = await todas<{ obra_id: number | null; numero_oc: string | null; etapa: string | null; parcial: number | null; estado: string | null }>((a, b) => {
      let q = supabase.from("v_oc_items_calc").select("obra_id, numero_oc, etapa, parcial, estado");
      if (obra) q = q.eq("obra_id", Number(obra));
      return q.order("id").range(a, b);
    });
    for (const l of lineas) {
      const k = claveOrden(l.obra_id, l.numero_oc);
      if (!filtradas.has(k)) continue;
      const e = l.etapa ?? "Sin etapa";
      // Una anulada cuenta como orden de la etapa, pero no suma (su total es 0).
      const monto = l.estado === "ANULADA" ? 0 : Number(l.parcial) || 0;
      enEtapa.set(`${k}|${e}`, (enEtapa.get(`${k}|${e}`) ?? 0) + monto);
      const es = etapasDeOrden.get(k) ?? [];
      if (!es.includes(e)) etapasDeOrden.set(k, [...es, e]);
      const t = totalesEtapa.get(e) ?? { ordenes: new Set<string>(), suma: 0 };
      t.ordenes.add(k);
      t.suma += monto;
      totalesEtapa.set(e, t);
    }
  }
  type Orden = NonNullable<typeof ordenes>[number];
  // Facturadas: lo que les falta para poder enviarlas a Tesorería (la guía de una OC que la requiere, el
  // contrato firmado de una OS). Sin nada pendiente, «Por enviar».
  const falta = new Map<string, "Subir guía" | "Firmar contrato">();
  const facturadas = (ordenes ?? []).filter((o) => o.estado === "FACTURADA");
  // Rechazadas por Tesorería y aún sin reenviar (en cualquier pestaña): se dicen así. Se piden a la vez que lo
  // que les falta a las facturadas (no dependen de eso).
  const conRechazo = new Set<string>();
  const activas = (ordenes ?? []).filter((o) => ["EMITIDA", "PRECIOS_CONFIRMADOS", "FACTURADA"].includes(o.estado ?? ""));
  const rechazosP = activas.length
    ? supabase
        .from("rechazos")
        .select("obra_id, numero")
        .is("reenviado_at", null)
        .in("obra_id", [...new Set(activas.map((o) => o.obra_id))])
        .in("numero", [...new Set(activas.map((o) => o.numero))])
    : Promise.resolve({ data: [] as { obra_id: number; numero: string }[] });
  if (facturadas.length) {
    const obrasF = [...new Set(facturadas.map((o) => o.obra_id))];
    const numerosF = [...new Set(facturadas.map((o) => o.numero))];
    const [{ data: ocs }, { data: guias }, { data: contratos }] = await Promise.all([
      supabase.from("ordenes_compra").select("obra_id, numero, tipo, requiere_guia, es_retencion, historico").in("obra_id", obrasF).in("numero", numerosF),
      supabase.from("guias").select("obra_id, numero_oc").in("estado", ["EMITIDA", "ANULACION_PENDIENTE"]).in("obra_id", obrasF).in("numero_oc", numerosF),
      supabase.from("adjuntos").select("obra_id, numero_oc").eq("tipo", "CONTRATO").in("obra_id", obrasF).in("numero_oc", numerosF),
    ]);
    const conGuia = new Set((guias ?? []).map((g) => `${g.obra_id}-${g.numero_oc}`));
    const conContrato = new Set((contratos ?? []).map((c) => `${c.obra_id}-${c.numero_oc}`));
    for (const o of ocs ?? []) {
      const k = `${o.obra_id}-${o.numero}`;
      // Las históricas (Excel) no esperan contrato ni guía.
      if (o.historico) continue;
      if (o.tipo === "OS" && !o.es_retencion && !conContrato.has(k)) falta.set(k, "Firmar contrato");
      else if (o.tipo === "OC" && o.requiere_guia && !conGuia.has(k)) falta.set(k, "Subir guía");
    }
  }
  for (const r of (await rechazosP).data ?? []) conRechazo.add(`${r.obra_id}-${r.numero}`);
  const rechazada = (o: Orden) => conRechazo.has(`${o.obra_id}-${o.numero}`);
  const href = (o: Orden) => `/logistica/ordenes/${o.obra_id}/${encodeURIComponent(o.numero ?? "")}?tipo=${tipo}`;
  const anulada = (o: Orden) => o.estado === "ANULADA";
  const etiqueta = (o: Orden) =>
    !anulada(o) && rechazada(o)
      ? "Rechazada"
      : !anulada(o) && o.has_alertas
      ? "Sobreprecio"
      : o.estado === "FACTURADA"
        ? (falta.get(`${o.obra_id}-${o.numero}`) ?? ESTADO_LABEL.FACTURADA)
        : o.estado
          ? ESTADO_LABEL[o.estado]
          : "";
  const colorEstado = (o: Orden) =>
    anulada(o) || rechazada(o) ? "font-semibold text-danger" : o.has_alertas ? "font-semibold text-warn" : "text-ink-2";
  // Cada pestaña ya es un estado: la fila solo lo repite en «Todas»; en las demás, solo si dice algo más
  // (sobreprecio, la guía o el contrato que falta, anulada).
  const aviso = (o: Orden): string | null =>
    tab === "todas" || anulada(o) || rechazada(o) || o.has_alertas || (o.estado === "FACTURADA" && falta.has(`${o.obra_id}-${o.numero}`)) ? etiqueta(o) : null;
  // Con una obra elegida arriba, repetirla en cada fila sobra.
  const conObra = !obra;

  /** Fila de la lista (Lista y Por obra; en Por obra la obra ya va en el grupo). */
  const fila = (o: Orden, mostrarObra = conObra) => (
    <li key={`${o.obra_id}-${o.numero}`} className="border-b border-line last:border-0">
      <Link prefetch={false} href={href(o)} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3 active:bg-ink/8">
        <span className="rotulo text-[23px] font-semibold leading-tight">{o.numero}</span>
        <span className="rotulo text-right text-[21px] font-medium leading-tight">{soles(o.total)}</span>
        <span className="truncate text-[15px] text-ink">{o.proveedor}</span>
        <span className={cn("text-right text-sm", colorEstado(o))}>{aviso(o) ?? fecha(o.fecha)}</span>
        {mostrarObra ? <span className="truncate text-sm text-ink-3">{o.obra}</span> : <span />}
        <span className="num text-right text-sm text-ink-3">{aviso(o) ? fecha(o.fecha) : ""}</span>
      </Link>
    </li>
  );

  /** Fila de una línea: N°, proveedor (u obra, en Por proveedor) y total, con el estado debajo del total. */
  const filaCompacta = (o: Orden, texto: string | null = o.proveedor) => (
    <li key={`${o.obra_id}-${o.numero}`} className="border-b border-line last:border-0">
      <Link prefetch={false} href={href(o)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 active:bg-ink/8">
        <span className="rotulo text-[18px] font-semibold leading-tight">{o.numero}</span>
        <span className="truncate text-[15px]">{texto}</span>
        <span className="num flex items-center justify-end gap-1 text-right text-[16px] font-semibold">
          {!anulada(o) && o.has_alertas && <TriangleAlert size={15} role="img" aria-label="Sobreprecio" className="shrink-0 text-warn" />}
          <span className={cn(anulada(o) && "text-danger line-through")}>{soles(o.total)}</span>
        </span>
        {aviso(o) && <span className={cn("col-start-3 text-right text-[13px]", colorEstado(o))}>{aviso(o)}</span>}
      </Link>
    </li>
  );

  /** Tarjeta: proveedor y total grandes; N°, obra, fecha y estado. */
  const tarjeta = (o: Orden) => (
    <li key={`${o.obra_id}-${o.numero}`}>
      <Link prefetch={false} href={href(o)} className="flex flex-col gap-1.5 rounded-panel bg-surface px-4 py-3 active:bg-sunken">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-[16px] font-semibold leading-snug [overflow-wrap:anywhere]">{o.proveedor}</span>
          <span className={cn("rotulo shrink-0 text-right text-[24px] font-semibold leading-none", anulada(o) && "text-danger line-through")}>
            {soles(o.total)}
          </span>
        </span>
        <span className="flex justify-between gap-3 text-sm text-ink-3">
          <span className="truncate">
            <span className="rotulo text-[16px] font-semibold text-ink-2">{o.numero}</span>
            {conObra && ` · ${o.obra}`}
          </span>
          <span className="num shrink-0">{fecha(o.fecha)}</span>
        </span>
        {aviso(o) && (
          <span
            className={cn(
              "self-start rounded-full px-2.5 py-0.5 text-sm",
              anulada(o) ? "bg-danger/10 text-danger" : o.has_alertas ? "bg-warn-bg font-semibold text-warn" : "bg-sunken text-ink-2",
            )}
          >
            {aviso(o)}
          </span>
        )}
      </Link>
    </li>
  );

  /** Diseños agrupados, en el orden en que aparecen (por monto, del mayor al menor), con su cantidad y su suma. */
  const porGrupo = (lista: Orden[]) => {
    const por = agrupado!;
    const g = new Map<string, { titulo: string; ordenes: Orden[] }>();
    for (const o of lista) {
      const { clave, titulo } = grupoDe(por, { ...o, monto: Number(o.total) || 0 });
      g.set(clave, { titulo, ordenes: [...(g.get(clave)?.ordenes ?? []), o] });
    }
    return ordenGrupos(por, [...g.keys()]).map((k) => {
      const { titulo, ordenes: os } = g.get(k)!;
      const t = totalesGrupo.get(k) ?? { n: os.length, suma: 0 };
      return (
        <div key={k} className="pb-1">
          <h3 className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
            <span className="flex min-w-0 items-baseline text-[16px] font-semibold">
              <span className="truncate">{titulo}</span>{" "}
              <span className="num shrink-0 pl-1 font-normal text-ink-3">{t.n}</span>
            </span>
            <span className="num shrink-0 text-[15px] text-ink-2">{soles(t.suma)}</span>
          </h3>
          <ul className="overflow-hidden rounded-panel bg-surface">
            {os.map((o) =>
              por === "obra" ? fila(o, false) : filaCompacta(o, por === "proveedor" ? (conObra ? o.obra : fecha(o.fecha)) : o.proveedor),
            )}
          </ul>
        </div>
      );
    });
  };

  // Tabla: columnas fijas, también en la cabecera.
  // El estado va bajo el proveedor: a 360 px no entra en su propia columna.
  const COLS_TABLA = "grid grid-cols-[4.5rem_minmax(0,1fr)_5.75rem] items-baseline gap-x-2 px-3";
  const tabla = (lista: Orden[]) => (
    <div className="overflow-hidden rounded-panel bg-surface">
      <div aria-hidden className={cn(COLS_TABLA, "border-b border-line bg-sunken/60 py-2 text-[13px] font-medium text-ink-2")}>
        <span>N°</span>
        <span>{tab === "todas" ? "Proveedor y estado" : "Proveedor"}</span>
        <span className="text-right">Total</span>
      </div>
      <ul>
        {lista.map((o) => (
          <li key={`${o.obra_id}-${o.numero}`} className="border-b border-line last:border-0">
            <Link prefetch={false} href={href(o)} className={cn(COLS_TABLA, "py-2 text-[14px] active:bg-ink/8")}>
              <span className="rotulo truncate text-[16px] font-semibold">{o.numero}</span>
              <span className="min-w-0">
                <span className="block truncate">{o.proveedor}</span>
                {aviso(o) && <span className={cn("block truncate text-[13px]", colorEstado(o))}>{aviso(o)}</span>}
              </span>
              <span className={cn("num text-right font-semibold", anulada(o) && "text-danger line-through")}>{soles(o.total)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  /** Mosaico: dos columnas de tarjetas chicas. */
  const mosaico = (lista: Orden[]) => (
    <ul className="grid grid-cols-2 gap-2">
      {lista.map((o) => (
        <li key={`${o.obra_id}-${o.numero}`}>
          <Link prefetch={false} href={href(o)} className="flex h-full flex-col gap-1 rounded-panel bg-surface p-3 active:bg-sunken">
            <span className="rotulo text-[18px] font-semibold leading-tight">{o.numero}</span>
            <span className={cn("rotulo text-[20px] font-medium leading-tight", anulada(o) && "text-danger line-through")}>{soles(o.total)}</span>
            <span className="line-clamp-2 text-[14px] leading-snug">{o.proveedor}</span>
            <span className={cn("num mt-auto text-[13px]", aviso(o) ? colorEstado(o) : "text-ink-3")}>{aviso(o) ?? fecha(o.fecha)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
  /** Por etapa, en el orden de las etapas: cada orden con lo que pide en esa etapa (y su total, si toca varias). */
  const vistaPorEtapa = (lista: Orden[]) => {
    const posicion = new Map((etapas ?? []).map((e, i) => [e.codigo, i]));
    const g = new Map<string, Orden[]>();
    for (const o of lista)
      for (const e of etapasDeOrden.get(claveOrden(o.obra_id, o.numero)) ?? ["Sin etapa"]) g.set(e, [...(g.get(e) ?? []), o]);
    return [...g.keys()]
      .sort((a, b) => (posicion.get(a) ?? 999) - (posicion.get(b) ?? 999) || a.localeCompare(b))
      .map((e) => {
        const os = g.get(e)!;
        const t = totalesEtapa.get(e);
        return (
          <div key={e} className="pb-1">
            <h3 className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
              <span className="flex min-w-0 items-baseline text-[16px] font-semibold">
                <span className="rotulo truncate text-[19px]">{e}</span>{" "}
                <span className="num shrink-0 pl-1 font-normal text-ink-3">{t?.ordenes.size ?? os.length}</span>
              </span>
              <span className="num shrink-0 text-[15px] text-ink-2">{soles(t?.suma ?? 0)}</span>
            </h3>
            <ul className="overflow-hidden rounded-panel bg-surface">
              {os.map((o) => {
                const k = claveOrden(o.obra_id, o.numero);
                const varias = (etapasDeOrden.get(k)?.length ?? 0) > 1;
                return (
                  <li key={`${k}-${e}`} className="border-b border-line last:border-0">
                    <Link prefetch={false} href={href(o)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 active:bg-ink/8">
                      <span className="rotulo text-[18px] font-semibold leading-tight">{o.numero}</span>
                      <span className="truncate text-[15px]">{o.proveedor}</span>
                      <span className={cn("num text-right text-[16px] font-semibold", anulada(o) && "text-danger line-through")}>
                        {soles(enEtapa.get(`${k}|${e}`) ?? 0)}
                      </span>
                      <span className={cn("num col-span-2 truncate text-[13px]", aviso(o) ? colorEstado(o) : "text-ink-3")}>{aviso(o) ?? fecha(o.fecha)}</span>
                      <span className="num text-right text-[13px] text-ink-3">{varias ? `de ${soles(o.total)}` : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      });
  };
  const sinOrdenes = <p className="py-10 text-center text-ink-3">Sin órdenes</p>;

  return (
    <>
      <TopBar
        title={tipo === "OC" ? "Órdenes de compra" : "Órdenes de servicio"}
        right={
          <>
            <SelectorDiseno pantalla="logistica" actual={diseno} fijo={fijo} />
            <UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />
          </>
        }
      />
      <RecordarFiltros clave="ordenes" base={["tipo"]} />
      <main className={cn("mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20", !fijo && "pt-3")}>
        {/* Buscador, filtros y pestañas; con «Fijar filtros arriba» quedan bajo la barra al desplazar. */}
        <div className={fijo ? CLASE_FIJO : "contents"}>
        {/* Como en Tesorería: la obra a la vista y «Filtros» con cuántos hay activos (sin empresa). */}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <UrlSelect
              param="obra"
              label="Obra"
              value={obra ?? TODOS}
              options={[{ value: TODOS, label: "Todas las obras" }, ...(obras ?? []).map((o) => ({ value: String(o.id), label: o.nombre }))]}
            />
          </div>
          <FiltrosHoja
            secciones={[
              { tipo: "opciones", param: "orden", titulo: "Ordenar por", def: "fecha.desc", opciones: ORDEN },
              // Cada pestaña ya es un estado: el filtro de estado solo va en «Todas».
              ...(estados
                ? []
                : [
                    {
                      tipo: "opciones" as const,
                      param: "estado",
                      titulo: "Estado",
                      opciones: [
                        { value: TODOS, label: "Todos" },
                        ...(Object.entries(ESTADO_LABEL) as [EstadoOC, string][])
                          .filter(([e]) => e !== "BORRADOR")
                          .map(([value, label]) => ({ value, label })),
                      ],
                    },
                  ]),
              { tipo: "fecha", param: "fecha", titulo: "Fecha" },
              { tipo: "opciones", param: "monto", titulo: "Monto", opciones: [{ value: TODOS, label: "Todos" }, ...MONTOS] },
              {
                tipo: "lista",
                param: "proveedor",
                titulo: "Proveedor",
                opciones: (proveedores ?? []).map((p) => ({ value: String(p.id), label: p.razon_social, hint: p.ruc_o_cod })),
              },
              { tipo: "varias", param: "etapa", titulo: "Etapas", opciones: (etapas ?? []).map((e) => e.codigo) },
              { tipo: "varias", param: "material", titulo: "Tipos de material", opciones: (tipos ?? []).map((t) => t.codigo) },
              {
                tipo: "opciones",
                param: "alerta",
                titulo: "Sobreprecio",
                opciones: [
                  { value: TODOS, label: "Todos" },
                  { value: "si", label: "Con sobreprecio" },
                  { value: "no", label: "Sin sobreprecio" },
                ],
              },
            ]}
          />
        </div>
        <Tabs
          param="tab"
          current={tab}
          quitar={["estado"]}
          // Nueve pestañas: en dos filas, con nombres cortos, para que se vean todas a 360 px.
          porFila={5}
          options={(Object.entries(TABS) as [keyof typeof TABS, EstadoOC[] | null][]).map(([value]) => ({
            value,
            label: value === "fact" && tipo === "OS" ? "Contrato" : PESTANAS[value],
          }))}
        />
        <SearchBox placeholder="N°, proveedor, obra o ítem" />
        </div>
        {error && <p role="alert" className="text-danger">{error.message}</p>}
        {porEtapa ? (
          (ordenes ?? []).length ? vistaPorEtapa(ordenes ?? []) : !error && sinOrdenes
        ) : agrupado ? (
          (ordenes ?? []).length ? porGrupo(ordenes ?? []) : !error && sinOrdenes
        ) : diseno === "tabla" ? (
          (ordenes ?? []).length ? tabla(ordenes ?? []) : !error && sinOrdenes
        ) : diseno === "mosaico" ? (
          (ordenes ?? []).length ? mosaico(ordenes ?? []) : !error && sinOrdenes
        ) : diseno === "tarjetas" ? (
          (ordenes ?? []).length ? <ul className="flex flex-col gap-2">{(ordenes ?? []).map(tarjeta)}</ul> : !error && sinOrdenes
        ) : diseno === "compacta" ? (
          <Lista encabezadoFijo={!fijo} encabezado={["N° · Proveedor", tab === "todas" ? <Pila key="d">{["Total", "Estado"]}</Pila> : "Total"]}>
            {(ordenes ?? []).map((o) => filaCompacta(o))}
            {(ordenes ?? []).length === 0 && !error && <li className="px-4 py-10 text-center text-ink-3">Sin órdenes</li>}
          </Lista>
        ) : (
        <Lista
          encabezadoFijo={!fijo}
          encabezado={[
            <Pila key="i">{conObra ? ["N° orden", "Proveedor", "Obra"] : ["N° orden", "Proveedor"]}</Pila>,
            <Pila key="d">{tab === "todas" ? ["Total", "Estado", "Fecha"] : ["Total", "Fecha"]}</Pila>,
          ]}
        >
          {(ordenes ?? []).map((o) => fila(o))}
          {(ordenes ?? []).length === 0 && !error && <li className="px-4 py-10 text-center text-ink-3">Sin órdenes</li>}
        </Lista>
        )}
        <VerMas visibles={ordenes?.length ?? 0} limite={limite} />
      </main>
      <ButtonLink
        href={`/logistica/ordenes/nueva?tipo=${tipo}${obra ? `&obra=${obra}` : ""}`}
        aria-label={tipo === "OC" ? "Nueva orden de compra" : "Nueva orden de servicio"}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Nueva
      </ButtonLink>
    </>
  );
}
