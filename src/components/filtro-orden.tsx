"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/format";
import { RANGO_RE, TODOS, etiquetaRango } from "@/lib/filtros";
import { iniciarCarga } from "./barra-carga";
import { Button } from "./ui/button";
import { RangoFechas } from "./rango-fechas";
import { Field } from "./ui/field";
import { SearchSelect, type Option } from "./ui/search-select";
import { Sheet } from "./ui/sheet";

/** `rango`: suma la opción "Personalizado", que abre un calendario para elegir desde–hasta. */
export type Filtro = {
  param: string;
  label: string;
  options: Option[];
  rango?: boolean;
  /** Etiqueta de «sin filtro» cuando el sustantivo es femenino (p. ej. «Todas» para Empresa). */
  todos?: string;
};

const PERSONALIZADO = "rango";

/**
 * Botón "Filtrar" + hoja con "Ordenar por" y filtros. Todo vive en la URL
 * (`orden` y un parámetro por filtro); el valor TODOS equivale a no filtrar.
 * Debajo muestra los filtros activos, cada uno con su ✕; el contenedor debe ser `flex-wrap`.
 */
export function FiltroOrden({
  orden,
  ordenDefault,
  filtros = [],
}: {
  orden: Option[];
  ordenDefault: string;
  filtros?: Filtro[];
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const actual = (p: string, def: string) => params.get(p) ?? def;
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  // Rango personalizado con solo el primer día tocado (el siguiente toque cierra el rango).
  const [rangoAbierto, setRangoAbierto] = useState<Record<string, boolean>>({});
  const valor = (p: string, def: string) => borrador[p] ?? actual(p, def);

  const activos =
    filtros.filter((f) => actual(f.param, TODOS) !== TODOS).length +
    (actual("orden", ordenDefault) !== ordenDefault ? 1 : 0);

  const aplicar = (valores: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [p, v] of Object.entries(valores)) {
      const def = p === "orden" ? ordenDefault : TODOS;
      // "Personalizado" sin fechas elegidas equivale a no filtrar.
      if (v === def || v === PERSONALIZADO) next.delete(p);
      else next.set(p, v);
    }
    next.delete("n");
    if (next.toString() !== params.toString()) iniciarCarga();
    router.replace(`${path}?${next}`, { scroll: false });
    setOpen(false);
  };

  // Filtros activos con su etiqueta legible, para mostrarlos y quitarlos de a uno.
  const chips = [
    ...filtros
      .filter((f) => actual(f.param, TODOS) !== TODOS)
      .map((f) => {
        const v = actual(f.param, TODOS);
        const etiqueta =
          f.rango && RANGO_RE.test(v)
            ? etiquetaRango(v)
            : (f.options.find((o) => o.value === v)?.label ?? v);
        return { param: f.param, def: TODOS, texto: `${f.label}: ${etiqueta}` };
      }),
    ...(actual("orden", ordenDefault) !== ordenDefault
      ? [
          {
            param: "orden",
            def: ordenDefault,
            texto:
              orden.find((o) => o.value === actual("orden", ordenDefault))
                ?.label ?? "Orden",
          },
        ]
      : []),
  ];
  const limpiarTodo = () =>
    aplicar(
      Object.fromEntries([
        ["orden", ordenDefault],
        ...filtros.map((f) => [f.param, TODOS]),
      ]),
    );

  const abrir = () => {
    setBorrador({});
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label={
          activos
            ? `Filtrar y ordenar (${activos} activos)`
            : "Filtrar y ordenar"
        }
        className={cn(
          "flex h-12 shrink-0 items-center gap-1.5 rounded-field border px-3 text-[15px] font-semibold active:bg-sunken",
          activos
            ? "border-primary text-primary"
            : "border-line bg-surface text-ink",
        )}
      >
        <SlidersHorizontal size={18} />
        {activos > 0 && <span className="num">{activos}</span>}
      </button>
      {chips.length > 0 && (
        <div className="flex w-full min-w-0 basis-full flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.param}
              type="button"
              onClick={() => aplicar({ [c.param]: c.def })}
              aria-label={`Quitar ${c.texto}`}
              className="flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pl-3 pr-2.5 text-[14px] active:bg-sunken"
            >
              <span className="truncate">{c.texto}</span>
              <X size={15} className="shrink-0 text-ink-3" />
            </button>
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              onClick={limpiarTodo}
              className="min-h-11 rounded-full px-4 text-[14px] font-semibold text-primary active:bg-sunken"
            >
              Limpiar
            </button>
          )}
        </div>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filtrar y ordenar"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={limpiarTodo}>
              Limpiar
            </Button>
            <Button
              className="flex-1"
              onClick={() =>
                aplicar(
                  Object.fromEntries([
                    ["orden", valor("orden", ordenDefault)],
                    ...filtros.map((f) => [f.param, valor(f.param, TODOS)]),
                  ]),
                )
              }
            >
              Aplicar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          {orden.length > 1 && (
            <Field label="Ordenar por">
              <SearchSelect
                label="Ordenar por"
                value={valor("orden", ordenDefault)}
                onChange={(v) => setBorrador((b) => ({ ...b, orden: v }))}
                options={orden}
              />
            </Field>
          )}
          {filtros.map((f) => {
            const v = valor(f.param, TODOS);
            const personalizado =
              !!f.rango && (v === PERSONALIZADO || RANGO_RE.test(v));
            const r = RANGO_RE.exec(v);
            return (
              <div key={f.param} className="flex flex-col gap-2">
                <Field label={f.label}>
                  <SearchSelect
                    label={f.label}
                    value={personalizado ? PERSONALIZADO : v}
                    onChange={(nuevo) =>
                      setBorrador((b) => ({ ...b, [f.param]: nuevo }))
                    }
                    options={[
                      { value: TODOS, label: f.todos ?? "Todos" },
                      ...f.options,
                      ...(f.rango
                        ? [{ value: PERSONALIZADO, label: "Personalizado" }]
                        : []),
                    ]}
                  />
                </Field>
                {personalizado && (
                  <RangoFechas
                    valor={
                      r
                        ? {
                            desde: r[1],
                            hasta:
                              r[1] === r[2] && rangoAbierto[f.param]
                                ? null
                                : r[2],
                          }
                        : null
                    }
                    onChange={({ desde, hasta }) => {
                      setRangoAbierto((a) => ({
                        ...a,
                        [f.param]: hasta == null,
                      }));
                      setBorrador((b) => ({
                        ...b,
                        [f.param]: `${desde}_${hasta ?? desde}`,
                      }));
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
