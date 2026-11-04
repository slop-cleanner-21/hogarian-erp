"use client";

import { Check, Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { iniciarCarga } from "@/components/barra-carga";
import { IconoTodas, LogoEmpresa } from "@/components/logo-empresa";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import type { Option } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { UrlSelect } from "@/components/url-select";
import { FILTROS_PAGO, type FiltroPago } from "@/lib/filtro-pago";
import { TODOS } from "@/lib/filtros";
import { cn, matches } from "@/lib/format";

/**
 * Fila de filtros del presupuesto (Tesorería): empresa con su logo, la obra y «Filtros» (etapas, varias a
 * la vez, y estado de pago), con cuántos hay activos.
 */
export function FiltrosPresupuesto({
  empresas,
  empresa,
  obras,
  obraId,
  etapas,
  etapasSel,
  pago,
}: {
  empresas: { id: string; nombre: string }[];
  empresa: string | null;
  obras: Option[];
  obraId: string;
  /** Etapas de la obra, en su orden. */
  etapas: string[];
  etapasSel: string[];
  pago: FiltroPago | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [hoja, setHoja] = useState<"empresa" | "filtros" | null>(null);
  const actual = empresas.find((e) => e.id === empresa) ?? null;
  const activos = etapasSel.length + (pago ? 1 : 0);

  const ir = (cambios: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    iniciarCarga();
    router.replace(`${path}?${next}`, { scroll: false });
  };

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setHoja("empresa")}
        aria-label={`Empresa: ${actual?.nombre ?? "todas"}`}
        className="flex h-12 w-14 shrink-0 items-center justify-center rounded-field border border-line bg-surface p-1 active:bg-sunken"
      >
        {actual ? <LogoEmpresa nombre={actual.nombre} className="h-full w-full" /> : <IconoTodas className="h-full w-full" />}
      </button>
      <div className="min-w-0 flex-1">
        <UrlSelect param="obra" label="Obra" value={obraId} options={obras} />
      </div>
      <button
        type="button"
        onClick={() => setHoja("filtros")}
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

      {hoja === "empresa" && (
        <Sheet open onClose={() => setHoja(null)} title="Empresa">
          <ul className="grid grid-cols-2 gap-2 p-4">
            {[{ id: TODOS, nombre: "Todas" }, ...empresas].map((e) => {
              const elegida = (e.id === TODOS && !actual) || e.id === actual?.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-pressed={elegida}
                    onClick={() => {
                      setHoja(null);
                      // La obra elegida puede no ser de la otra empresa: se toma la primera de esa.
                      ir({ empresa: e.id, obra: null });
                    }}
                    className={cn(
                      "flex w-full flex-col items-center gap-2 rounded-panel border-2 bg-surface p-3 text-[15px] font-semibold active:bg-sunken",
                      elegida ? "border-primary" : "border-line",
                    )}
                  >
                    {e.id === TODOS ? <IconoTodas className="h-14 w-full" /> : <LogoEmpresa nombre={e.nombre} className="h-14 w-full" />}
                    {e.nombre}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {hoja === "filtros" && (
        <HojaFiltros
          etapas={etapas}
          etapasSel={etapasSel}
          pago={pago}
          onClose={() => setHoja(null)}
          onAplicar={(sel, p) => {
            setHoja(null);
            ir({ etapa: sel.length ? sel.join(",") : TODOS, pago: p });
          }}
        />
      )}
    </div>
  );
}

function HojaFiltros({
  etapas,
  etapasSel,
  pago,
  onClose,
  onAplicar,
}: {
  etapas: string[];
  etapasSel: string[];
  pago: FiltroPago | null;
  onClose: () => void;
  onAplicar: (etapas: string[], pago: FiltroPago | null) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(etapasSel));
  const [estado, setEstado] = useState<FiltroPago | null>(pago);
  const [q, setQ] = useState("");
  const visibles = etapas.filter((e) => !q || matches(e, q));
  const alternar = (e: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Filtros"
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSel(new Set());
              setEstado(null);
            }}
          >
            Limpiar
          </Button>
          <Button onClick={() => onAplicar(etapas.filter((e) => sel.has(e)), estado)}>Aplicar</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <section aria-label="Pago" className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold text-ink-2">Pago</h3>
          <div role="radiogroup" aria-label="Pago" className="flex flex-wrap gap-2">
            {[{ value: null, label: "Todos" }, ...FILTROS_PAGO].map((o) => {
              const activo = estado === o.value;
              return (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => setEstado(o.value)}
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

        <section aria-label="Etapas" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-ink-2">Etapas</h3>
            <span className="num text-[14px] text-ink-3">{sel.size ? `${sel.size} de ${etapas.length}` : "Todas"}</span>
          </div>
          {etapas.length > 8 && (
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar etapa"
                aria-label="Buscar etapa"
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
      </div>
    </Sheet>
  );
}
