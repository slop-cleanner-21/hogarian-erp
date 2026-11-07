"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Lista, Pila } from "@/components/lista";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { SearchSelect, SearchSheet } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { SIN_TIPO } from "@/lib/filtros";
import { cn } from "@/lib/format";
import { parecidos } from "@/lib/parecidos";
import type { Item, Rubro } from "@/lib/types";

/** Ítem del catálogo completo (para avisar de parecidos al crear uno). */
export type ItemCatalogo = { id: number; descripcion: string; unidad: string | null; rubro: Rubro };
import { crearItem } from "@/app/gerencia/actions";
import { actualizarTipoMaterial } from "../actions";
import { NuevoTipoSheet } from "../nuevo-tipo";
import { Faltan } from "@/components/ui/faltan";

const RUBROS_SERVICIO: Rubro[] = ["MANO OBRA", "SUBCONTRATO", "LOCACION", "PROYECTO", "FINALIZACION", "OTRO"];
type Clase = "mat" | "serv";
const ETIQUETA_TIPO: Record<Clase, string> = { mat: "Tipo de material", serv: "Especialidad" };
const NUEVO_TIPO: Record<Clase, string> = { mat: "Nuevo tipo de material", serv: "Nueva especialidad" };

const opcionesTipo = (tipos: string[]) => [
  ...tipos.map((t) => ({ value: t, label: t })),
  { value: SIN_TIPO, label: "Sin tipo" },
];

export function ItemsList({
  items,
  unidades,
  tipos,
  clase,
  rubroDefault,
  tipoDefault,
  crear = null,
  clasificar: puedeClasificar = false,
}: {
  items: Item[];
  unidades: string[];
  tipos: string[];
  clase: Clase;
  rubroDefault: Rubro;
  tipoDefault: string | null;
  /** Gerencia: crea ítems (con la cuenta contable, opcional, de entre estas). */
  crear?: { cuentas: { codigo: string; denominacion: string }[]; catalogo: ItemCatalogo[] } | null;
  /** Logística: cambia el tipo de material (o la especialidad) de un ítem. */
  clasificar?: boolean;
}) {
  const [nuevo, setNuevo] = useState(false);
  const [activo, setActivo] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [tiposOpt, setTipoOpt] = useOptimistic(
    new Map<number, string | null>(),
    (prev, [id, t]: [number, string | null]) => new Map(prev).set(id, t),
  );
  const tipoDe = (i: Item) => (tiposOpt.has(i.id) ? tiposOpt.get(i.id)! : i.tipo_material);
  // Tipo nuevo pedido desde la hoja de un ítem: al crearse, se le asigna.
  const [nuevoTipo, setNuevoTipo] = useState<{ item: Item; texto: string } | null>(null);

  const clasificar = (v: string, item = activo!) => {
    const tipo = v === SIN_TIPO ? null : v;
    startTransition(async () => {
      setTipoOpt([item.id, tipo]);
      const res = await actualizarTipoMaterial(item.id, tipo);
      setError(res.ok ? null : res.error);
    });
  };

  return (
    <>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Lista
        encabezado={[
          <Pila key="i">{["Descripción", clase === "mat" ? "Tipo de material" : "Rubro y especialidad"]}</Pila>,
          "Unidad",
        ]}
      >
        {items.map((i) => (
          <li key={i.id} className="border-b border-line last:border-0">
            <button
              type="button"
              disabled={!puedeClasificar}
              onClick={() => setActivo(i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink/8 disabled:active:bg-transparent"
            >
              <div className="min-w-0 flex-1">
                <div className="leading-snug">{i.descripcion}</div>
                {clase === "serv" ? (
                  <div className="flex gap-3 text-sm text-ink-3">
                    <span>{i.rubro}</span>
                    {tipoDe(i) && <span>{tipoDe(i)}</span>}
                  </div>
                ) : (
                  tipoDe(i) && <div className="text-sm text-ink-3">{tipoDe(i)}</div>
                )}
                {crear && i.cuenta_contable && <div className="num text-sm text-ink-3">Cuenta {i.cuenta_contable}</div>}
              </div>
              <span className="shrink-0 text-sm text-ink-3">{i.unidad}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin resultados</li>}
      </Lista>
      {crear && (
        <Button
          aria-label={clase === "mat" ? "Nuevo material" : "Nuevo servicio"}
          onClick={() => setNuevo(true)}
          className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
        >
          <Plus size={22} /> Nuevo
        </Button>
      )}
      {activo && (
        <SearchSheet
          open
          onClose={() => setActivo(null)}
          title={activo.descripcion}
          value={tipoDe(activo) ?? SIN_TIPO}
          onChange={(v) => clasificar(v)}
          options={opcionesTipo(tipos)}
          crear={{ label: NUEVO_TIPO[clase], onCrear: (texto) => setNuevoTipo({ item: activo, texto }) }}
        />
      )}
      {nuevoTipo && (
        <NuevoTipoSheet
          titulo={NUEVO_TIPO[clase]}
          inicial={nuevoTipo.texto}
          onCreado={(codigo) => clasificar(codigo, nuevoTipo.item)}
          onClose={() => setNuevoTipo(null)}
        />
      )}
      {nuevo && crear && (
        <NuevoItemSheet
          cuentas={crear.cuentas}
          catalogo={crear.catalogo}
          unidades={unidades}
          tipos={tipos}
          clase={clase}
          rubroDefault={rubroDefault}
          tipoDefault={tipoDefault}
          onClose={() => setNuevo(false)}
        />
      )}
    </>
  );
}

function NuevoItemSheet({
  cuentas,
  catalogo,
  unidades,
  tipos,
  clase,
  rubroDefault,
  tipoDefault,
  onClose,
}: {
  cuentas: { codigo: string; denominacion: string }[];
  catalogo: ItemCatalogo[];
  unidades: string[];
  tipos: string[];
  clase: Clase;
  rubroDefault: Rubro;
  tipoDefault: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState("");
  const [unidad, setUnidad] = useState<string | null>(null);
  const [rubro, setRubro] = useState<Rubro>(rubroDefault);
  const [tipo, setTipo] = useState<string>(tipoDefault ?? SIN_TIPO);
  const [tolerancia, setTolerancia] = useState("5");
  const [cuenta, setCuenta] = useState<string | null>(null);
  // Ítems con nombre parecido (para no duplicar); con uno igual no se guarda.
  const similares = useMemo(() => parecidos(descripcion, catalogo), [descripcion, catalogo]);
  const igual = similares.find((p) => p.igual);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guardar = () =>
    startTransition(async () => {
      const res = await crearItem({
        descripcion,
        unidad: unidad ?? "",
        rubro,
        tolerancia_pct: Number(tolerancia) / 100,
        tipo_material: tipo === SIN_TIPO ? null : tipo,
        cuenta_contable: cuenta,
      });
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={clase === "mat" ? "Nuevo material" : "Nuevo servicio"}
      footer={
        <div className="flex flex-col gap-2">
          <Faltan items={[!descripcion.trim() && "descripción", !unidad && "unidad", !!igual && "otro nombre: ya existe"]} />
          <Button size="lg" onClick={guardar} disabled={pending || !descripcion.trim() || !unidad || !!igual}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Descripción">
          <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} autoComplete="off" />
        </Field>
        {similares.length > 0 && (
          <section aria-label="Ítems parecidos" className={cn("-mt-2 rounded-field border px-3 py-2", igual ? "border-danger bg-danger-bg" : "border-line")}>
            <p className={cn("text-[14px] font-semibold", igual ? "text-danger" : "text-ink-2")}>
              {igual ? "Ya existe con ese nombre" : "Ya existen parecidos"}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {similares.map(({ item, igual: mismo }) => (
                <li key={item.id} className="flex items-baseline gap-2 text-[15px] leading-snug">
                  <span className={cn("min-w-0 flex-1", mismo && "font-semibold")}>{item.descripcion}</span>
                  <span className="shrink-0 text-[13px] text-ink-3">
                    {item.unidad}
                    {item.rubro !== "MATERIAL" && ` · ${item.rubro}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidad">
            <SearchSelect label="Unidad" value={unidad} onChange={setUnidad} options={unidades.map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label="Tolerancia %">
            <NumberInput value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} />
          </Field>
        </div>
        {clase === "serv" && (
          <Field label="Rubro">
            <SearchSelect
              label="Rubro"
              value={rubro}
              onChange={(v) => setRubro(v as Rubro)}
              options={RUBROS_SERVICIO.map((r) => ({ value: r, label: r }))}
            />
          </Field>
        )}
        <Field label={ETIQUETA_TIPO[clase]}>
          <SearchSelect
            label={ETIQUETA_TIPO[clase]}
            value={tipo}
            onChange={setTipo}
            options={opcionesTipo(tipos)}
          />
        </Field>
        <Field label="Cuenta contable (opcional)">
          <SearchSelect
            label="Cuenta contable"
            value={cuenta}
            onChange={setCuenta}
            placeholder="Sin cuenta"
            multilinea
            options={cuentas.map((c) => ({ value: c.codigo, label: `${c.codigo} · ${c.denominacion}` }))}
          />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
