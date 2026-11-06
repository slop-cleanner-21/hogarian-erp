"use client";

import { MarcaAdicional } from "@/components/marca-adicional";
import { Check, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActionBar } from "@/components/action-bar";
import { TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input, NumberInput, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { TODOS as TODAS, SIN_TIPO } from "@/lib/filtros";
import { cn, fecha, hoyISO, matches, qty, soles, solesPu } from "@/lib/format";
import { PROVEEDOR_VACIO, ProveedorSheet } from "../../proveedores/proveedores-list";
import { borrarBorrador, claveBorrador, guardarBorrador, leerBorrador, type BorradorCuenta } from "@/lib/borrador-orden";
import { ETIQUETA_GARANTIA, GARANTIA_DEFECTO, categoriaGarantia, pctValido, retenidoDe, type CategoriaGarantia, type Garantia } from "@/lib/garantia";
import { faltaSuspension } from "@/lib/retencion";
import type { Proveedor, TipoOrden, VPartida } from "@/lib/types";
import { crearOrden, guardarBorradorOrden } from "../../actions";

type ObraOpt = { id: number; nombre: string; empresa: string };
type ProveedorOpt = Pick<Proveedor, "id" | "ruc_o_cod" | "razon_social" | "comprobante_habitual" | "suspension_4ta_fecha"> & { tipos: string[] };
/** Venta previa: [item_id, proveedor_id, fecha de la última orden, su P.U.]. */
export type Venta = [number, number, string, number | null];


const ORDEN_GARANTIA: CategoriaGarantia[] = ["mano", "sub", "adic"];

/** Las partidas, siempre por etapa y código (sin desplegable para ordenar). */
const porEtapa = (a: VPartida, b: VPartida) =>
  (a.etapa ?? "").localeCompare(b.etapa ?? "") || (a.codigo ?? "").localeCompare(b.codigo ?? "", undefined, { numeric: true });


/** Lo que el proveedor ya vendió de los ítems elegidos: última orden y su P.U.; primero los vendidos. */
function VentasProveedor({ items, ventas }: { items: VPartida[]; ventas: Map<number, { fecha: string; pu: number | null }> }) {
  const orden = [...items].sort((a, b) => Number(ventas.has(b.item_id!)) - Number(ventas.has(a.item_id!)));
  return (
    <ul className="flex flex-col gap-1.5">
      {orden.map((p) => {
        const v = ventas.get(p.item_id!);
        return (
          <li key={p.item_id} className="flex items-start gap-2 text-[15px] leading-snug">
            {v ? <Check size={17} className="mt-0.5 shrink-0 text-ok" /> : <X size={17} className="mt-0.5 shrink-0 text-ink-3" />}
            <span className={cn("min-w-0 flex-1", !v && "text-ink-3")}>{p.descripcion}</span>
            <span className="num shrink-0 text-right text-[14px] text-ink-2">
              {v ? (
                <>
                  {v.pu == null ? "Sin precio" : solesPu(v.pu)}
                  <span className="block text-ink-3">{fecha(v.fecha)}</span>
                </>
              ) : (
                "No lo vendió"
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function NuevaOrden({
  tipo,
  obraId,
  obras,
  proveedores: proveedoresIniciales,
  partidas,
  historial,
  tiposMaterial,
  requeridos,
  atender,
  siguienteNumero,
  filtros,
  usuario,
  borrador,
}: {
  /** Para recordar lo avanzado por usuario en este dispositivo. */
  usuario: string;
  /** El borrador de la cuenta que se retoma. */
  borrador: BorradorCuenta | null;
  tipo: TipoOrden;
  obraId: number | null;
  obras: ObraOpt[];
  proveedores: ProveedorOpt[];
  partidas: VPartida[];
  historial: Venta[];
  tiposMaterial: string[];
  /** Lo que Operaciones requirió y aún no se compra, por partida (solo indicación). */
  requeridos: Record<number, number>;
  /** Atender un requerimiento: partidas y cantidades que faltan (la orden arranca con ellas). */
  atender?: { numero: string; lineas: Record<number, number> } | null;
  siguienteNumero: string;
  /** Filtros de partidas que llegan en la URL (se recuerdan entre visitas). */
  filtros: { etapa: string | null; req: string | null; tmat: string | null; orden: string | null; vista: string | null; q: string | null };
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2>(atender && Object.keys(atender.lineas).length ? 2 : 1);
  // Proveedores creados desde aquí (aún no llegan en la lista del servidor).
  const [creados, setCreados] = useState<ProveedorOpt[]>([]);
  const proveedores = [...proveedoresIniciales, ...creados.filter((c) => !proveedoresIniciales.some((p) => p.id === c.id))];
  const [nuevoProv, setNuevoProv] = useState<string | null>(null);
  const [etapa, setEtapaS] = useState(filtros.etapa ?? TODAS);
  const [tipoMat, setTipoMatS] = useState(filtros.tmat ?? TODAS);
  // Pendientes: aún tienen saldo por pedir. Completas: ya se pidió todo el presupuesto (solo consulta).
  const [vista, setVistaS] = useState<"pend" | "comp">(filtros.vista === "comp" ? "comp" : "pend");
  const [q, setQS] = useState(filtros.q ?? "");

  // Los filtros viven en la URL sin recargar la página: así se recuerdan al volver.
  const enUrl = (param: string, valor: string, porDefecto: string) => {
    const url = new URL(window.location.href);
    if (valor === porDefecto) url.searchParams.delete(param);
    else url.searchParams.set(param, valor);
    window.history.replaceState(null, "", url);
  };
  const setEtapa = (v: string) => (setEtapaS(v), enUrl("etapa", v, TODAS));
  const setTipoMat = (v: string) => (setTipoMatS(v), enUrl("tmat", v, TODAS));
  const setVista = (v: "pend" | "comp") => (setVistaS(v), enUrl("vista", v, "pend"));
  const setQ = (v: string) => (setQS(v), enUrl("q", v, ""));
  // partida_id -> cantidad (texto para permitir edición libre)
  const [sel, setSel] = useState<Map<number, string>>(
    () => new Map(Object.entries(atender?.lineas ?? {}).map(([id, c]) => [Number(id), String(Number(c.toFixed(4)))])),
  );
  // El N° lo pone el sistema (el siguiente de la obra, contando las anuladas): no se escribe a mano.
  const numero = siguienteNumero;
  const [proveedorId, setProveedorIdS] = useState<string | null>(null);
  // OS: el comprobante que emitirá el proveedor (define el contrato) y la fecha de inicio de los trabajos;
  // la de fin es la de la OS (hoy).
  const [comprobante, setComprobante] = useState<"RXH" | "FACTURA" | null>(null);
  const [fechaInicio, setFechaInicio] = useState("");
  const inicioInvalido = fechaInicio !== "" && fechaInicio > hoyISO();
  const setProveedorId = (v: string | null) => {
    setProveedorIdS(v);
    const habitual = [...proveedoresIniciales, ...creados].find((p) => String(p.id) === v)?.comprobante_habitual;
    if (habitual === "RXH" || habitual === "FACTURA") setComprobante(habitual);
  };
  const [requiereGuia, setRequiereGuia] = useState(false);
  const [garantia, setGarantia] = useState<Garantia>(GARANTIA_DEFECTO);

  // Lo avanzado queda en el dispositivo: al salir y volver a Nueva (o cerrar la app), sigue como estaba.
  const clave = claveBorrador(usuario, tipo, borrador?.id);
  const restaurado = useRef(!!atender);
  const [listo, setListo] = useState(!!atender);
  useEffect(() => {
    if (restaurado.current) return;
    const local = leerBorrador(clave);
    // De un borrador de la cuenta, lo editado aquí si es más nuevo que lo guardado.
    const b =
      borrador && obraId && !(local && local.guardado > Date.parse(borrador.actualizado))
        ? { ...borrador.datos, obraId, guardado: Date.parse(borrador.actualizado) }
        : local;
    if (b && !obraId) {
      router.replace(`/logistica/ordenes/nueva?tipo=${tipo}&obra=${b.obraId}`);
      return;
    }
    restaurado.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage no existe en el servidor: se lee después de hidratar */
    if (b && b.obraId === obraId) {
      const vivas = b.sel.filter(([id]) => partidas.some((p) => p.id === id && Number(p.saldo_cant) > 0));
      setSel(new Map(vivas));
      if (proveedoresIniciales.some((p) => String(p.id) === b.proveedorId)) setProveedorIdS(b.proveedorId);
      setComprobante(b.comprobante);
      setFechaInicio(b.fechaInicio);
      setRequiereGuia(b.requiereGuia);
      if (b.garantia) setGarantia(b.garantia);
      if (b.paso === 2 && vivas.length) setPaso(2);
    }
    setListo(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [borrador, clave, obraId, partidas, proveedoresIniciales, router, tipo]);
  useEffect(() => {
    if (!listo || !obraId || atender) return;
    const elegidas = [...sel].filter(([id]) => partidas.some((p) => p.id === id));
    if (!elegidas.length) return borrarBorrador(clave);
    guardarBorrador(clave, { obraId, paso, sel: elegidas, proveedorId, comprobante, fechaInicio, requiereGuia, garantia });
  }, [listo, clave, obraId, atender, paso, sel, partidas, proveedorId, comprobante, fechaInicio, requiereGuia, garantia]);

  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const obra = obras.find((o) => o.id === obraId);
  const titulo = tipo === "OC" ? "Nueva OC" : "Nueva OS";

  const etapas = useMemo(() => [...new Set(partidas.map((p) => p.etapa))], [partidas]);
  const tiposMat = useMemo(
    () => [...new Set(partidas.map((p) => p.tipo_material).filter((t): t is string => !!t))].sort(),
    [partidas],
  );

  const [soloRequeridas, setSoloRequeridas] = useState(false);
  const conRequerimiento = useMemo(() => partidas.filter((p) => (requeridos[p.id!] ?? 0) > 0.0001).length, [partidas, requeridos]);
  const filtradas = useMemo(
    () =>
      partidas.filter(
        (p) =>
          (!soloRequeridas || (requeridos[p.id!] ?? 0) > 0.0001) &&
          (etapa === TODAS || p.etapa === etapa) &&
          (tipoMat === TODAS || (tipoMat === SIN_TIPO ? !p.tipo_material : p.tipo_material === tipoMat)) &&
          (!q || matches(`${p.descripcion} ${p.codigo}`, q)),
      ).sort(porEtapa),
    [partidas, etapa, tipoMat, q, soloRequeridas, requeridos],
  );
  const pendientes = useMemo(() => filtradas.filter((p) => Number(p.saldo_cant) > 0), [filtradas]);
  const completas = useMemo(() => filtradas.filter((p) => Number(p.saldo_cant) <= 0), [filtradas]);
  const visibles = vista === "pend" ? pendientes : completas;

  const todosVisiblesSel = pendientes.length > 0 && pendientes.every((p) => sel.has(p.id));

  const toggle = (p: VPartida) =>
    Number(p.saldo_cant) > 0 &&
    setSel((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, String(p.saldo_cant));
      return next;
    });

  const toggleTodos = () =>
    setSel((prev) => {
      const next = new Map(prev);
      if (todosVisiblesSel) pendientes.forEach((p) => next.delete(p.id));
      else pendientes.forEach((p) => !next.has(p.id) && next.set(p.id, String(p.saldo_cant)));
      return next;
    });

  const seleccionadas = partidas.filter((p) => sel.has(p.id));
  const invalidas = seleccionadas.filter((p) => {
    const c = Number(sel.get(p.id));
    return !(c > 0) || c > Number(p.saldo_cant);
  });

  const emitir = () =>
    startTransition(async () => {
      setError(null);
      const res = await crearOrden({
        obraId: obraId!,
        numero,
        proveedorId: Number(proveedorId),
        tipo,
        requiereGuia,
        ...(tipo === "OS" ? { comprobante: comprobante!, fechaInicio } : {}),
        items: seleccionadas.map((p) => ({
          partida_id: p.id,
          cantidad: Number(sel.get(p.id)),
          ...(tipo === "OS" ? { ret_garantia_pct: Number(garantia[categoriaGarantia(p)]) } : {}),
        })),
        ...(borrador ? { borradorId: borrador.id } : {}),
      });
      if (!res.ok) {
        setConfirmar(false);
        setError(res.error);
        return;
      }
      borrarBorrador(clave);
      router.replace(`/logistica/ordenes/${obraId}/${encodeURIComponent(res.data)}?tipo=${tipo}`);
    });

  // A la cuenta: queda en la pestaña Borradores y se puede empezar otra orden.
  const guardarEnCuenta = () =>
    startTransition(async () => {
      setError(null);
      const res = await guardarBorradorOrden({
        id: borrador?.id ?? null,
        tipo,
        obraId: obraId!,
        datos: { paso, sel: seleccionadas.map((p) => [p.id, sel.get(p.id) ?? ""]), proveedorId, comprobante, fechaInicio, requiereGuia, garantia },
      });
      if (!res.ok) return setError(res.error);
      borrarBorrador(clave);
      router.replace(`/logistica?tipo=${tipo}&tab=bor`);
    });

  const categorias = [...new Set(seleccionadas.map(categoriaGarantia))].sort((a, b) => ORDEN_GARANTIA.indexOf(a) - ORDEN_GARANTIA.indexOf(b));
  const garantiaInvalida = tipo === "OS" && categorias.some((c) => !pctValido(garantia[c]));
  const retenido =
    tipo === "OS"
      ? seleccionadas.reduce((a, p) => a + retenidoDe(Number(sel.get(p.id)) * Number(p.pu ?? 0), Number(garantia[categoriaGarantia(p)]) || 0), 0)
      : 0;

  const proveedor = proveedores.find((p) => String(p.id) === proveedorId);
  const bruto = seleccionadas.reduce((a, p) => a + Number(sel.get(p.id)) * Number(p.pu ?? 0), 0);
  const avisoSuspension = tipo === "OS" && comprobante === "RXH" && !!proveedor && faltaSuspension(bruto - retenido, proveedor.suspension_4ta_fecha, hoyISO());

  // Primero quienes ya vendieron estos ítems (más ítems y más reciente), luego quienes venden ese
  // tipo de material y después el resto. La marca lo muestra también al buscar.
  const opcionesProveedor = (() => {
    const items = new Set(seleccionadas.map((p) => p.item_id));
    const vendidos = new Map<number, { n: number; ultima: string; porItem: Map<number, { fecha: string; pu: number | null }> }>();
    for (const [item, prov, f, pu] of historial) {
      if (!items.has(item)) continue;
      const v = vendidos.get(prov) ?? { n: 0, ultima: "", porItem: new Map() };
      v.porItem.set(item!, { fecha: f, pu });
      vendidos.set(prov, { n: v.n + 1, ultima: f > v.ultima ? f : v.ultima, porItem: v.porItem });
    }
    // Ítems elegidos (uno por ítem, aunque esté en varias etapas), para el detalle de cada proveedor.
    const itemsElegidos = [...new Map(seleccionadas.map((p) => [p.item_id!, p])).values()];
    const buscados = new Set(seleccionadas.map((p) => p.tipo_material).filter((t): t is string => !!t));
    return proveedores
      .map((p) => ({ p, v: vendidos.get(p.id), coinciden: p.tipos.filter((t) => buscados.has(t)) }))
      .sort(
        (a, b) =>
          (b.v?.n ?? 0) - (a.v?.n ?? 0) ||
          (b.v?.ultima ?? "").localeCompare(a.v?.ultima ?? "") ||
          b.coinciden.length - a.coinciden.length ||
          a.p.razon_social.localeCompare(b.p.razon_social),
      )
      .map(({ p, v, coinciden }) => ({
        value: String(p.id),
        label: p.razon_social,
        hint: v
          ? `${p.ruc_o_cod}, última orden ${fecha(v.ultima)}`
          : coinciden.length
            ? `${p.ruc_o_cod}, vende ${coinciden.join(", ")}`
            : p.ruc_o_cod,
        marca: v ? (items.size === 1 ? "Ya lo vendió" : `Vendió ${v.n} de ${items.size}`) : undefined,
        detalle: v ? <VentasProveedor items={itemsElegidos} ventas={v.porItem} /> : undefined,
      }));
  })();

  if (paso === 2 && obra) {
    return (
      <>
        <TopBar title={titulo} back={() => setPaso(1)} />
        <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-28 pt-3">
          {atender && <p className="font-semibold text-primary">Con lo que falta del {atender.numero}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° orden">
              <div className={cn(inputClass, "num flex items-center bg-transparent")}>{numero}</div>
            </Field>
            <Field label="Empresa">
              <div className={cn(inputClass, "flex items-center truncate bg-transparent")}>{obra.empresa}</div>
            </Field>
          </div>
          <Field label="Proveedor">
            <SearchSelect
              label="Proveedor"
              value={proveedorId}
              onChange={setProveedorId}
              options={opcionesProveedor}
              crear={{ label: "Nuevo proveedor", onCrear: setNuevoProv }}
            />
          </Field>
          {nuevoProv != null && (
            <ProveedorSheet
              proveedor={{
                ...PROVEEDOR_VACIO,
                ruc_o_cod: /^\d+$/.test(nuevoProv) ? nuevoProv : "",
                razon_social: /^\d+$/.test(nuevoProv) ? "" : nuevoProv.toUpperCase(),
                tipos: [...new Set(seleccionadas.map((p) => p.tipo_material).filter((t): t is string => !!t))].map((t) => ({ tipo_material: t })),
              }}
              tiposMaterial={tiposMaterial}
              onGuardado={(p) => {
                setCreados((c) => [...c, p]);
                setProveedorId(String(p.id));
              }}
              onClose={() => setNuevoProv(null)}
            />
          )}

          {tipo === "OS" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Comprobante">
                <SearchSelect
                  label="Comprobante"
                  value={comprobante}
                  onChange={(v) => setComprobante(v as "RXH" | "FACTURA")}
                  options={[
                    { value: "RXH", label: "Recibo por honorarios" },
                    { value: "FACTURA", label: "Factura" },
                  ]}
                  placeholder="Elegir"
                />
              </Field>
              <Field label="Fecha de inicio">
                <Input
                  type="date"
                  value={fechaInicio}
                  max={hoyISO()}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  aria-invalid={inicioInvalido}
                  className={cn(inicioInvalido && "border-danger")}
                />
              </Field>
              {inicioInvalido && <p className="col-span-2 text-danger">La fecha de inicio no puede ser posterior a la de fin ({fecha(hoyISO())})</p>}
              {avisoSuspension && <p role="status" className="col-span-2 font-semibold text-warn">Sin suspensión de 4ta: pídele la constancia al proveedor</p>}
            </div>
          )}

          {tipo === "OC" && (
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-panel bg-surface px-4">
              <span>Requiere guía de remisión</span>
              <input
                type="checkbox"
                checked={requiereGuia}
                onChange={(e) => setRequiereGuia(e.target.checked)}
                className="h-6 w-6 shrink-0 accent-primary"
              />
            </label>
          )}

          {tipo === "OS" && (
            <section aria-label="Retención por garantía" className="flex flex-col gap-2 rounded-panel bg-surface p-4">
              <h2 className="font-semibold">Retención por garantía</h2>
              {categorias.map((c) => (
                <label key={c} className="flex items-center justify-between gap-3">
                  <span>{ETIQUETA_GARANTIA[c]}</span>
                  <span className="flex items-center gap-2">
                    <NumberInput
                      aria-label={`Retención ${ETIQUETA_GARANTIA[c]}`}
                      value={garantia[c]}
                      onChange={(e) => setGarantia({ ...garantia, [c]: e.target.value })}
                      className={cn("w-20", !pctValido(garantia[c]) && "border-danger")}
                    />
                    %
                  </span>
                </label>
              ))}
              {retenido > 0.005 && (
                <p className="flex justify-between text-ink-2">
                  <span>Se retiene</span>
                  <span className="num">{soles(retenido)}</span>
                </p>
              )}
            </section>
          )}

          <ul className="overflow-hidden rounded-panel bg-surface">
            <li role="row" className="flex items-end gap-2 border-b border-line py-2 pl-4 pr-1 text-[13px] font-medium leading-tight text-ink-2">
              <span role="columnheader" className="flex flex-1 flex-col">
                <span>Partida</span>
                <span>Saldo máximo</span>
              </span>
              <span role="columnheader" className="w-24 text-right">Cantidad</span>
              <span className="w-11" />
            </li>
            {seleccionadas.map((p) => {
              const v = sel.get(p.id) ?? "";
              const c = Number(v);
              const mal = !(c > 0) || c > Number(p.saldo_cant);
              return (
                <li key={p.id} className="flex items-center gap-2 border-b border-line py-2 pl-4 pr-1 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug">{p.descripcion}</div>
                    <div className={cn("num text-sm", mal ? "font-medium text-danger" : "text-ink-3")}>
                      máx {qty(p.saldo_cant)} {p.unidad}
                    </div>
                  </div>
                  <NumberInput
                    aria-label={`Cantidad ${p.descripcion}`}
                    value={v}
                    onChange={(e) => setSel((prev) => new Map(prev).set(p.id, e.target.value))}
                    className={cn("w-24 shrink-0", mal && "border-danger")}
                  />
                  <button
                    type="button"
                    aria-label={`Quitar ${p.descripcion}`}
                    onClick={() => toggle(p)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                  >
                    <X size={20} />
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p role="alert" className="text-danger">{error}</p>}
        </main>
        <ActionBar>
          <Button variant="secondary" onClick={guardarEnCuenta} disabled={pending || seleccionadas.length === 0}>
            Guardar borrador
          </Button>
          <Button
            className="flex-1"
            disabled={
              !proveedorId ||
              seleccionadas.length === 0 ||
              invalidas.length > 0 ||
              garantiaInvalida ||
              (tipo === "OS" && (!comprobante || !fechaInicio || inicioInvalido))
            }
            onClick={() => setConfirmar(true)}
          >
            Confirmar
          </Button>
        </ActionBar>
        <Confirm
          open={confirmar}
          title={`¿Emitir ${tipo} ${numero}?`}
          onYes={emitir}
          onNo={() => setConfirmar(false)}
          pending={pending}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-3">Obra</dt>
            <dd>{obra.nombre}</dd>
            <dt className="text-ink-3">Proveedor</dt>
            <dd>{proveedor?.razon_social}</dd>
            <dt className="text-ink-3">Líneas</dt>
            <dd className="num">{seleccionadas.length}</dd>
            {tipo === "OS" && (
              <>
                <dt className="text-ink-3">Comprobante</dt>
                <dd>{comprobante === "FACTURA" ? "Factura" : "Recibo por honorarios"}</dd>
                <dt className="text-ink-3">Plazo</dt>
                <dd className="num">
                  {fechaInicio && fecha(fechaInicio)} – {fecha(hoyISO())}
                </dd>
                {retenido > 0.005 && (
                  <>
                    <dt className="text-ink-3">Garantía</dt>
                    <dd className="num">{soles(retenido)}</dd>
                  </>
                )}
              </>
            )}
            {tipo === "OC" && (
              <>
                <dt className="text-ink-3">Guía</dt>
                <dd>{requiereGuia ? "Sí" : "No"}</dd>
              </>
            )}
          </dl>
        </Confirm>
      </>
    );
  }

  return (
    <>
      <TopBar title={titulo} back={`/logistica?tipo=${tipo}`} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-28 pt-3">
        <SearchSelect
          label="Obra"
          placeholder="Obra"
          value={obraId ? String(obraId) : null}
          onChange={(v) => router.replace(`/logistica/ordenes/nueva?tipo=${tipo}&obra=${v}`)}
          options={obras.map((o) => ({ value: String(o.id), label: o.nombre, hint: o.empresa }))}
        />
        {obraId && (
          <>
            <div className={cn("grid gap-2", tiposMat.length > 0 && "grid-cols-2")}>
              {tiposMat.length > 0 && (
                <SearchSelect
                  label="Tipo de material"
                  value={tipoMat}
                  onChange={setTipoMat}
                  options={[
                    { value: TODAS, label: "Todos los tipos" },
                    ...tiposMat.map((t) => ({ value: t, label: t })),
                    { value: SIN_TIPO, label: "Sin tipo" },
                  ]}
                />
              )}
              <SearchSelect
                label="Etapa"
                value={etapa}
                onChange={setEtapa}
                options={[{ value: TODAS, label: "Todas las etapas" }, ...etapas.map((e) => ({ value: e, label: e }))]}
              />
            </div>
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar partida"
                aria-label="Buscar partida"
                className={cn(inputClass, "pl-10")}
              />
            </div>

            <div role="tablist" className="grid grid-cols-2 rounded-control bg-sunken p-1">
              {(
                [
                  ["pend", "Pendientes", pendientes.length],
                  ["comp", "Completas", completas.length],
                ] as const
              ).map(([v, label, n]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={vista === v}
                  onClick={() => setVista(v)}
                  className={cn(
                    "flex h-11 items-center justify-center gap-1.5 rounded-field text-[15px]",
                    vista === v ? "bg-surface font-semibold text-ink" : "text-ink-2",
                  )}
                >
                  {label} <span className="num text-ink-3">{n}</span>
                </button>
              ))}
            </div>

            {conRequerimiento > 0 && (
              <button
                type="button"
                onClick={() => setSoloRequeridas((v) => !v)}
                aria-pressed={soloRequeridas}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-[15px] font-semibold",
                  soloRequeridas ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink",
                )}
              >
                Requeridas por Operaciones <span className="num">{conRequerimiento}</span>
              </button>
            )}
            <div className="overflow-hidden rounded-panel bg-surface">
              {vista === "pend" && (
                <label className="flex min-h-13 items-center gap-3 border-b border-line px-4 font-medium">
                  <input
                    type="checkbox"
                    checked={todosVisiblesSel}
                    onChange={toggleTodos}
                    disabled={pendientes.length === 0}
                    className="h-5 w-5"
                  />
                  <span className="flex-1">Seleccionar todo</span>
                  <span className="num text-sm text-ink-3">{pendientes.length}</span>
                </label>
              )}
              <div
                role="row"
                className="flex items-end gap-3 border-b border-line py-2 pl-12 pr-4 text-[13px] font-medium leading-tight text-ink-2"
              >
                <span role="columnheader" className="flex flex-1 flex-col">
                  <span>Partida</span>
                  <span>Etapa y tipo</span>
                </span>
                <span role="columnheader" className="text-right">
                  Pedido / Presupuesto
                </span>
              </div>
              <ul>
                {visibles.map((p) => (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <label className={cn("flex items-center gap-3 px-4 py-2.5", vista === "pend" && "active:bg-ink/8")}>
                      {vista === "pend" ? (
                        <input
                          type="checkbox"
                          checked={sel.has(p.id)}
                          onChange={() => toggle(p)}
                          className="h-5 w-5 shrink-0"
                        />
                      ) : (
                        <Check size={20} className="shrink-0 text-ok" aria-label="Completa" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="leading-snug">{p.descripcion}</div>
                        <div className="flex flex-wrap gap-x-3 text-sm text-ink-3">
                          <span>{p.etapa}</span>
                          <MarcaAdicional requerimiento={p.requerimiento} />
                          {(requeridos[p.id!] ?? 0) > 0.0001 && (
                            <span className="num font-semibold text-warn">Requerido {qty(requeridos[p.id!])}</span>
                          )}
                        </div>
                      </div>
                      <div className="num shrink-0 whitespace-nowrap text-right text-sm">
                        <span className="font-medium">{qty(p.cant_comprometida)}</span>
                        <span className="text-ink-3">
                          {" / "}
                          {qty(p.cantidad_efectiva ?? p.cantidad)} {p.unidad}
                        </span>
                      </div>
                    </label>
                  </li>
                ))}
                {visibles.length === 0 && (
                  <li className="px-4 py-10 text-center text-ink-3">
                    {vista === "pend" ? "Sin partidas pendientes" : "Sin partidas completas"}
                  </li>
                )}
              </ul>
            </div>
          </>
        )}
      </main>
      {error && <p role="alert" className="mx-auto max-w-2xl px-4 pb-24 text-danger">{error}</p>}
      {obraId && (
        <ActionBar>
          {sel.size > 0 && (
            <Button variant="secondary" onClick={guardarEnCuenta} disabled={pending}>
              Guardar borrador
            </Button>
          )}
          <Button className="flex-1" disabled={sel.size === 0} onClick={() => setPaso(2)}>
            Continuar{sel.size > 0 && ` (${sel.size})`}
          </Button>
        </ActionBar>
      )}
    </>
  );
}
