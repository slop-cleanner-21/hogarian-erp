"use client";

import { Check, Copy, ListChecks, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent } from "react";
import { ActionBar } from "@/components/action-bar";
import { Lista, Pila } from "@/components/lista";
import { Button } from "@/components/ui/button";
import { SearchSheet } from "@/components/ui/search-select";
import { cn } from "@/lib/format";
import type { CuentaContable, Rubro } from "@/lib/types";
import { asignarCuenta, asignarCuentaItems, idsFiltrados } from "./actions";

export type FilaItem = { id: number; descripcion: string; unidad: string; rubro: Rubro; cuenta: string | null };
export type FiltrosCuentas = { tab: "sin" | "con"; q: string; rubro: string | null; comprobanteId: number | null };

/**
 * Asignación de cuentas a ítems. En escritorio, grilla tipo Excel: flechas para moverse, Enter para
 * elegir la cuenta, Ctrl+C / Ctrl+V para copiar y pegar la cuenta, Espacio o Ctrl/Shift+clic para
 * seleccionar varias filas. En el celular, lista con casillas. En ambos, asignación en grupo.
 */
export function CuentasList({ items, cuentas, filtros }: { items: FilaItem[]; cuentas: CuentaContable[]; filtros: FiltrosCuentas }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ancla, setAncla] = useState<number | null>(null);
  const [destino, setDestino] = useState<number[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [asignadas, asignar] = useOptimistic(new Map<number, string>(), (prev, cambios: [number[], string]) => {
    const next = new Map(prev);
    for (const id of cambios[0]) next.set(id, cambios[1]);
    return next;
  });
  const nombre = new Map(cuentas.map((c) => [c.codigo, c.denominacion]));
  const celdas = useRef<(HTMLButtonElement | null)[]>([]);
  const cuentaDe = (i: FilaItem) => asignadas.get(i.id) ?? i.cuenta;

  const aplicar = (ids: number[], cuenta: string) =>
    startTransition(async () => {
      setError(null);
      asignar([ids, cuenta]);
      const r = ids.length === 1 ? await asignarCuenta(ids[0], cuenta) : await asignarCuentaItems(ids, cuenta);
      if (!r.ok) return setError(r.error);
      setAviso(`${ids.length === 1 ? "1 ítem" : `${ids.length} ítems`} con la cuenta ${cuenta}`);
      setSel(new Set());
      router.refresh();
    });

  // Si la fila está en la selección, la acción va a toda la selección.
  const objetivo = (id: number) => (sel.has(id) && sel.size > 1 ? [...sel] : [id]);

  const alternar = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rango = (desde: number, hasta: number) => {
    const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
    setSel((s) => new Set([...s, ...items.slice(a, b + 1).map((i) => i.id)]));
  };

  const seleccionarFiltrado = () =>
    startTransition(async () => {
      const r = await idsFiltrados(filtros);
      if (!r.ok) return setError(r.error);
      setSel(new Set(r.data));
    });

  const clicFila = (e: MouseEvent, idx: number) => {
    const id = items[idx].id;
    if (e.shiftKey && ancla != null) rango(ancla, idx);
    else if (e.ctrlKey || e.metaKey) alternar(id);
    else return;
    e.preventDefault();
    setAncla(idx);
  };

  const teclas = async (e: KeyboardEvent, idx: number) => {
    const fila = items[idx];
    const mover = (d: number) => {
      const j = Math.min(items.length - 1, Math.max(0, idx + d));
      celdas.current[j]?.focus();
      if (e.shiftKey) rango(ancla ?? idx, j);
      else setAncla(j);
    };
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown") return (e.preventDefault(), mover(1));
    if (e.key === "ArrowUp") return (e.preventDefault(), mover(-1));
    if (e.key === " ") return (e.preventDefault(), alternar(fila.id), setAncla(idx));
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const c = cuentaDe(fila);
      if (!c) return setError("Esa fila no tiene cuenta");
      const ok = await navigator.clipboard.writeText(c).then(() => true, () => false);
      if (!ok) return setError("No se pudo copiar");
      setError(null);
      return setAviso(`Cuenta ${c} copiada`);
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      const texto = (await navigator.clipboard.readText().catch(() => "")).trim().split(/\s/)[0] ?? "";
      if (!nombre.has(texto)) return setError(`"${texto}" no es una cuenta del plan`);
      aplicar(objetivo(fila.id), texto);
    }
  };

  const copiarDescripcion = async (i: FilaItem) => {
    await navigator.clipboard.writeText(i.descripcion).catch(() => {});
    setAviso("Descripción copiada");
  };

  // Los ítems van a su cuenta de clase 9; de ahí salen los amarres.
  const opciones = cuentas.filter((c) => c.codigo.startsWith("9")).map((c) => ({ value: c.codigo, label: `${c.codigo} ${c.denominacion}` }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={seleccionarFiltrado} disabled={pending || items.length === 0} className="h-11 px-3 text-[15px]">
          <ListChecks size={18} /> Seleccionar todo lo filtrado
        </Button>
        {(aviso || error) && (
          <p role={error ? "alert" : "status"} className={cn("text-[15px]", error ? "text-danger" : "text-ink-2")}>
            {error ?? aviso}
          </p>
        )}
      </div>

      {/* Celular: lista con casillas */}
      <div className="lg:hidden">
        <Lista encabezado={[<Pila key="i">{["Ítem", "Rubro y unidad"]}</Pila>, "Cuenta"]}>
          {items.map((i) => {
            const cuenta = cuentaDe(i);
            return (
              <li key={i.id} className={cn("flex items-stretch border-b border-line last:border-0", sel.has(i.id) && "bg-primary/8")}>
                <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${i.descripcion}`}
                    checked={sel.has(i.id)}
                    onChange={() => alternar(i.id)}
                    className="h-5 w-5 accent-primary"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setDestino(objetivo(i.id))}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 text-left active:bg-ink/8"
                >
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug">{i.descripcion}</div>
                    <div className="flex gap-3 text-sm text-ink-3">
                      <span>{i.rubro}</span>
                      <span>{i.unidad}</span>
                    </div>
                  </div>
                  <div className={cn("shrink-0 text-right text-sm", cuenta ? "text-ink" : "text-ink-3")}>
                    {cuenta ? (
                      <>
                        <div className="num font-medium">{cuenta}</div>
                        <div className="max-w-32 truncate text-[13px] text-ink-3">{nombre.get(cuenta)}</div>
                      </>
                    ) : (
                      "Asignar"
                    )}
                  </div>
                </button>
              </li>
            );
          })}
          {items.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin ítems</li>}
        </Lista>
      </div>

      {/* Escritorio: grilla tipo Excel */}
      <div role="grid" aria-label="Cuentas de ítems" className="hidden overflow-hidden rounded-panel bg-surface lg:block">
        <div role="row" className="grid grid-cols-[2.5rem_1fr_9rem_4rem_14rem] border-b border-line text-[13px] font-medium text-ink-2">
          <span role="columnheader" className="px-2 py-2" />
          <span role="columnheader" className="px-3 py-2">Descripción</span>
          <span role="columnheader" className="px-3 py-2">Rubro</span>
          <span role="columnheader" className="px-3 py-2">Und</span>
          <span role="columnheader" className="px-3 py-2">Cuenta</span>
        </div>
        {items.map((i, idx) => {
          const cuenta = cuentaDe(i);
          return (
            <div
              key={i.id}
              role="row"
              aria-selected={sel.has(i.id)}
              onClick={(e) => clicFila(e, idx)}
              className={cn(
                "grid grid-cols-[2.5rem_1fr_9rem_4rem_14rem] items-center border-b border-line text-[15px] last:border-0",
                sel.has(i.id) && "bg-primary/8",
              )}
            >
              <span role="gridcell" className="flex justify-center">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-label={`Seleccionar ${i.descripcion}`}
                  checked={sel.has(i.id)}
                  onChange={() => (alternar(i.id), setAncla(idx))}
                  className="h-4 w-4 accent-primary"
                />
              </span>
              <span role="gridcell" className="flex min-w-0 items-center gap-1 px-3 py-1.5">
                <span className="truncate" title={i.descripcion}>
                  {i.descripcion}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Copiar descripción"
                  onClick={() => copiarDescripcion(i)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-3 hover:bg-ink/8"
                >
                  <Copy size={15} />
                </button>
              </span>
              <span role="gridcell" className="truncate px-3 text-ink-2">
                {i.rubro}
              </span>
              <span role="gridcell" className="px-3 text-ink-2">
                {i.unidad}
              </span>
              <button
                ref={(el) => {
                  celdas.current[idx] = el;
                }}
                type="button"
                role="gridcell"
                onKeyDown={(e) => teclas(e, idx)}
                onFocus={() => ancla == null && setAncla(idx)}
                onClick={(e) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
                  setDestino(objetivo(i.id));
                }}
                className="m-0.5 flex h-9 min-w-0 items-center gap-2 rounded-[6px] px-2.5 text-left outline-none focus:ring-2 focus:ring-primary"
              >
                {cuenta ? (
                  <>
                    <span className="num font-medium">{cuenta}</span>
                    <span className="truncate text-[13px] text-ink-3">{nombre.get(cuenta)}</span>
                  </>
                ) : (
                  <span className="text-ink-3">Asignar</span>
                )}
              </button>
            </div>
          );
        })}
        {items.length === 0 && <p className="px-4 py-10 text-center text-ink-3">Sin ítems</p>}
      </div>

      {sel.size > 0 && (
        <ActionBar>
          <Button variant="secondary" onClick={() => setSel(new Set())} aria-label="Quitar selección" className="w-12 px-0">
            <X size={20} />
          </Button>
          <Button className="flex-1" onClick={() => setDestino([...sel])} disabled={pending}>
            <Check size={18} /> Asignar cuenta a {sel.size}
          </Button>
        </ActionBar>
      )}

      {destino && (
        <SearchSheet
          open
          onClose={() => setDestino(null)}
          title={destino.length === 1 ? (items.find((i) => i.id === destino[0])?.descripcion ?? "Cuenta") : `Cuenta para ${destino.length} ítems`}
          value={destino.length === 1 ? (cuentaDe(items.find((i) => i.id === destino[0])!) ?? null) : null}
          onChange={(c) => {
            const ids = destino;
            setDestino(null);
            aplicar(ids, c);
          }}
          options={opciones}
        />
      )}
    </>
  );
}
