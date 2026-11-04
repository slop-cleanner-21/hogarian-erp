"use client";

import { Check, Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { iniciarCarga } from "@/components/barra-carga";
import { RangoFechas } from "@/components/rango-fechas";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { SearchSelect, type Option } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { FECHAS, RANGO_RE, TODOS } from "@/lib/filtros";
import { cn, matches } from "@/lib/format";

const PERSONALIZADO = "rango";

/**
 * Una sección de la hoja de filtros (cada una es un parámetro de la URL):
 * - opciones: una sola elección, en botones (`def`: el valor que equivale a no filtrar);
 * - fecha: los rangos de siempre y «Personalizado» con calendario;
 * - lista: una elección en un desplegable con buscador (proveedores);
 * - varias: casillas, varias a la vez (separadas por coma en la URL), con buscador si son muchas.
 */
export type Seccion =
  | { tipo: "opciones"; param: string; titulo: string; opciones: Option[]; def?: string }
  | { tipo: "fecha"; param: string; titulo: string }
  | { tipo: "lista"; param: string; titulo: string; opciones: Option[] }
  | { tipo: "varias"; param: string; titulo: string; opciones: string[] };

const defDe = (s: Seccion) => (s.tipo === "opciones" ? (s.def ?? TODOS) : TODOS);
const lista = (v: string) => v.split(",").filter((e) => e && e !== TODOS);

/** Botón «Filtros» con cuántos hay activos y una hoja por secciones. Todo vive en la URL. */
/**
 * `local`: los filtros viven en la pantalla (no en la URL), p. ej. para filtrar lo ya cargado sin volver a
 * pedirlo; recibe los valores actuales y se le devuelven los aplicados.
 */
export function FiltrosHoja({
  secciones,
  local,
}: {
  secciones: Seccion[];
  local?: { valores: Record<string, string>; onAplicar: (v: Record<string, string>) => void };
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [abierta, setAbierta] = useState(false);

  const actuales = Object.fromEntries(secciones.map((s) => [s.param, (local ? local.valores[s.param] : params.get(s.param)) ?? defDe(s)]));
  const activos = secciones.reduce(
    (n, s) => n + (s.tipo === "varias" ? lista(actuales[s.param]).length : actuales[s.param] !== defDe(s) ? 1 : 0),
    0,
  );

  const aplicar = (v: Record<string, string>) => {
    if (local) {
      setAbierta(false);
      local.onAplicar(Object.fromEntries(secciones.map((s) => [s.param, v[s.param] === "" ? defDe(s) : (v[s.param] ?? defDe(s))])));
      return;
    }
    const next = new URLSearchParams(params.toString());
    for (const s of secciones) {
      const x = v[s.param];
      if (x === defDe(s) || x === "" || x === PERSONALIZADO) next.delete(s.param);
      else next.set(s.param, x);
    }
    next.delete("n");
    setAbierta(false);
    if (next.toString() === params.toString()) return;
    iniciarCarga();
    router.replace(`${path}?${next}`, { scroll: false });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={activos ? `Filtros (${activos} activos)` : "Filtros"}
        className={cn(
          "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-field border bg-surface active:bg-sunken",
          activos ? "border-primary text-primary" : "border-line text-ink-2",
        )}
      >
        <SlidersHorizontal size={20} />
        {activos > 0 && (
          <span className="num absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[12px] font-bold text-primary-ink">
            {activos}
          </span>
        )}
      </button>
      {abierta && <Hoja secciones={secciones} inicial={actuales} onClose={() => setAbierta(false)} onAplicar={aplicar} />}
    </>
  );
}

/** Una sola elección, en botones (como «Pago» en el presupuesto). */
function Opciones({ titulo, opciones, valor, onChange }: { titulo: string; opciones: Option[]; valor: string; onChange: (v: string) => void }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold text-ink-2">{titulo}</h3>
      <div role="radiogroup" aria-label={titulo} className="flex flex-wrap gap-2">
        {opciones.map((o) => {
          const activo = valor === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => onChange(o.value)}
              className={cn(
                "h-11 rounded-full border px-4 text-[15px]",
                activo ? "border-primary bg-primary font-semibold text-primary-ink" : "border-line bg-surface text-ink",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Varias({ titulo, opciones, valor, onChange }: { titulo: string; opciones: string[]; valor: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const sel = new Set(lista(valor));
  const visibles = opciones.filter((e) => !q || matches(e, q));
  const alternar = (e: string) => {
    const n = new Set(sel);
    if (n.has(e)) n.delete(e);
    else n.add(e);
    onChange(opciones.filter((x) => n.has(x)).join(",") || TODOS);
  };
  return (
    <section aria-label={titulo} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink-2">{titulo}</h3>
        <span className="num text-[14px] text-ink-3">{sel.size ? `${sel.size} de ${opciones.length}` : "Todas"}</span>
      </div>
      {opciones.length > 8 && (
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar ${titulo.toLowerCase().replace(/s$/, "")}`}
            aria-label={`Buscar ${titulo.toLowerCase().replace(/s$/, "")}`}
            className={cn(inputClass, "pl-10")}
          />
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2">
        {visibles.map((e) => {
          const marcada = sel.has(e);
          return (
            <li key={e}>
              <button
                type="button"
                role="checkbox"
                aria-checked={marcada}
                onClick={() => alternar(e)}
                className={cn(
                  "flex h-12 w-full items-center gap-2 rounded-field border px-3 text-left",
                  marcada ? "border-primary bg-primary/10 font-semibold" : "border-line bg-surface",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                    marcada ? "border-primary bg-primary text-primary-ink" : "border-line",
                  )}
                >
                  {marcada && <Check size={14} strokeWidth={3} />}
                </span>
                <span className="truncate">{e}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fecha({ titulo, valor, onChange }: { titulo: string; valor: string; onChange: (v: string) => void }) {
  // Rango personalizado con solo el primer día tocado (el siguiente toque cierra el rango).
  const [abierto, setAbierto] = useState(false);
  const r = RANGO_RE.exec(valor);
  const personalizado = valor === PERSONALIZADO || !!r;
  return (
    <div className="flex flex-col gap-2">
      <Opciones
        titulo={titulo}
        opciones={[{ value: TODOS, label: "Todas" }, ...FECHAS, { value: PERSONALIZADO, label: "Personalizado" }]}
        valor={personalizado ? PERSONALIZADO : valor}
        onChange={onChange}
      />
      {personalizado && (
        <RangoFechas
          valor={r ? { desde: r[1], hasta: r[1] === r[2] && abierto ? null : r[2] } : null}
          onChange={({ desde, hasta }) => {
            setAbierto(hasta == null);
            onChange(`${desde}_${hasta ?? desde}`);
          }}
        />
      )}
    </div>
  );
}

function Hoja({
  secciones,
  inicial,
  onClose,
  onAplicar,
}: {
  secciones: Seccion[];
  inicial: Record<string, string>;
  onClose: () => void;
  onAplicar: (v: Record<string, string>) => void;
}) {
  const [v, setV] = useState(inicial);
  const poner = (p: string, x: string) => setV((a) => ({ ...a, [p]: x }));

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Filtros"
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button variant="secondary" onClick={() => setV(Object.fromEntries(secciones.map((s) => [s.param, defDe(s)])))}>
            Limpiar
          </Button>
          <Button onClick={() => onAplicar(v)}>Aplicar</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        {secciones.map((s) =>
          s.tipo === "opciones" ? (
            <Opciones key={s.param} titulo={s.titulo} opciones={s.opciones} valor={v[s.param]} onChange={(x) => poner(s.param, x)} />
          ) : s.tipo === "fecha" ? (
            <Fecha key={s.param} titulo={s.titulo} valor={v[s.param]} onChange={(x) => poner(s.param, x)} />
          ) : s.tipo === "varias" ? (
            <Varias key={s.param} titulo={s.titulo} opciones={s.opciones} valor={v[s.param]} onChange={(x) => poner(s.param, x)} />
          ) : (
            <section key={s.param} aria-label={s.titulo} className="flex flex-col gap-2">
              <h3 className="text-[15px] font-semibold text-ink-2">{s.titulo}</h3>
              <SearchSelect label={s.titulo} value={v[s.param]} onChange={(x) => poner(s.param, x)} options={[{ value: TODOS, label: "Todos" }, ...s.opciones]} />
            </section>
          ),
        )}
      </div>
    </Sheet>
  );
}
