"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Lista, Pila } from "@/components/lista";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, matches } from "@/lib/format";
import { guardarCuenta, itemsDeCuenta, type ItemCuenta } from "./actions";

export type CuentaPlan = { codigo: string; denominacion: string; tipo: string; items: number; amarre_debe: string | null; amarre_haber: string | null };
type Opcion = { value: string; label: string; hint: string };

const TIPOS = ["GASTO", "ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO"].map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }));
const SIN_NOMBRE = "Sin denominación";

/** Plan de cuentas: nombrar las cuentas (las importadas llegan "Sin denominación"), sus amarres y crear nuevas. */
export function PlanCuentas({ cuentas, opciones }: { cuentas: CuentaPlan[]; opciones: Opcion[] }) {
  const [editando, setEditando] = useState<CuentaPlan | "nueva" | null>(null);
  return (
    <>
      <Lista encabezado={[<Pila key="i">{["Cuenta", "Denominación"]}</Pila>, <Pila key="d">{["Ítems", "Tipo"]}</Pila>]}>
        {cuentas.map((c) => (
          <li key={c.codigo} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => setEditando(c)}
              className="grid w-full grid-cols-[1fr_auto] gap-x-4 px-4 py-3 text-left active:bg-ink/8"
            >
              <span className="num text-[17px] font-semibold">{c.codigo}</span>
              <span className="num text-right text-ink-2">{c.items || ""}</span>
              <span className={cn("line-clamp-2", c.denominacion === SIN_NOMBRE ? "font-semibold text-warn" : "text-ink")}>
                {c.denominacion}
              </span>
              <span className="text-right text-sm text-ink-3">{TIPOS.find((t) => t.value === c.tipo)?.label ?? c.tipo}</span>
            </button>
          </li>
        ))}
        {cuentas.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin cuentas</li>}
      </Lista>
      <Button
        onClick={() => setEditando("nueva")}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Nueva cuenta
      </Button>
      {editando && <EditarCuenta cuenta={editando === "nueva" ? null : editando} opciones={opciones} onClose={() => setEditando(null)} />}
    </>
  );
}

const SIN_AMARRE = "-";

function EditarCuenta({ cuenta, opciones, onClose }: { cuenta: CuentaPlan | null; opciones: Opcion[]; onClose: () => void }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(cuenta?.codigo ?? "");
  const [denominacion, setDenominacion] = useState(cuenta && cuenta.denominacion !== SIN_NOMBRE ? cuenta.denominacion : "");
  const [tipo, setTipo] = useState(cuenta?.tipo ?? "GASTO");
  const [debe, setDebe] = useState(cuenta?.amarre_debe ?? SIN_AMARRE);
  const [haber, setHaber] = useState(cuenta?.amarre_haber ?? SIN_AMARRE);
  const falta = debe === SIN_AMARRE && haber !== SIN_AMARRE ? "Debe" : haber === SIN_AMARRE && debe !== SIN_AMARRE ? "Haber" : null;
  // Código y denominación en la etiqueta: el botón elegido muestra qué cuenta es sin abrir el selector.
  const opcionesAmarre = [
    { value: SIN_AMARRE, label: "Sin amarre" },
    ...opciones.filter((o) => o.value !== cuenta?.codigo).map((o) => ({ value: o.value, label: `${o.value} ${o.hint}`.trim() })),
  ];
  const [error, setError] = useState<string | null>(null);
  // Un error del servidor deja de valer en cuanto se corrige un dato.
  const con =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setError(null);
      set(v);
    };
  const [pending, startTransition] = useTransition();

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarCuenta(
        { codigo, denominacion, tipo, amarre_debe: debe === SIN_AMARRE ? null : debe, amarre_haber: haber === SIN_AMARRE ? null : haber },
        !cuenta,
      );
      if (!r.ok) return setError(r.error);
      router.refresh();
      onClose();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={cuenta ? `Cuenta ${cuenta.codigo}` : "Nueva cuenta"}
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-danger">{error}</p>}
          <Button className="w-full" onClick={guardar} disabled={pending || !codigo || denominacion.trim().length < 2 || falta !== null}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {!cuenta && (
          <Field label="Código">
            <Input value={codigo} onChange={(e) => con(setCodigo)(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="num" data-autofocus />
          </Field>
        )}
        <Field label="Denominación">
          <Input value={denominacion} onChange={(e) => con(setDenominacion)(e.target.value)} />
        </Field>
        <Field label="Tipo">
          <SearchSelect label="Tipo" value={tipo} onChange={con(setTipo)} options={TIPOS} />
        </Field>
        <div className="flex flex-col gap-4">
          <Field label="Amarre Debe">
            <SearchSelect label="Amarre Debe" value={debe} onChange={con(setDebe)} options={opcionesAmarre} multilinea />
          </Field>
          <Field label="Amarre Haber">
            <SearchSelect label="Amarre Haber" value={haber} onChange={con(setHaber)} options={opcionesAmarre} multilinea />
          </Field>
        </div>
        {falta && <p className="-mt-2 text-sm text-warn">Falta el amarre de {falta}</p>}
        {cuenta && cuenta.items > 0 && <ItemsCuenta codigo={cuenta.codigo} total={cuenta.items} />}
      </div>
    </Sheet>
  );
}

/** Ítems que usan la cuenta, con buscador cuando son muchos. */
function ItemsCuenta({ codigo, total }: { codigo: string; total: number }) {
  const [items, setItems] = useState<ItemCuenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    itemsDeCuenta(codigo).then((r) => (r.ok ? setItems(r.data) : setError(r.error)));
  }, [codigo]);
  const visibles = (items ?? []).filter((i) => !q || matches(i.descripcion, q));

  return (
    <section aria-label="Ítems de la cuenta" className="flex flex-col gap-2">
      <h3 className="text-[15px] font-medium text-ink-2">Ítems ({total})</h3>
      {total > 10 && (
        <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 py-2">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ítem" aria-label="Buscar ítem" />
        </div>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!items && !error && <p className="text-ink-3">Cargando…</p>}
      {items && (
        <ul className="overflow-hidden rounded-field border border-line">
          {visibles.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2 last:border-0">
              <span className="min-w-0 leading-snug">{i.descripcion}</span>
              <span className="shrink-0 text-sm text-ink-3">{i.unidad ?? i.rubro}</span>
            </li>
          ))}
          {visibles.length === 0 && <li className="px-3 py-4 text-center text-ink-3">Sin resultados</li>}
        </ul>
      )}
    </section>
  );
}
