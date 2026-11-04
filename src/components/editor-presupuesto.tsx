"use client";

import { MarcaAdicional, nombreAdicional } from "@/components/marca-adicional";
import { Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { guardarPartidas, type PartidaEdicion } from "@/app/presupuesto/actions";
import { TODOS } from "@/lib/filtros";
import { cn, matches, money, qty } from "@/lib/format";
import { ActionBar } from "./action-bar";
import { FiltrosHoja } from "./filtros-hoja";
import { Button } from "./ui/button";
import { Field, NumberInput, inputClass } from "./ui/field";
import { SearchSelect } from "./ui/search-select";
import { Sheet } from "./ui/sheet";

export type PartidaPresupuesto = {
  id: number;
  etapa: string;
  requerimiento: string;
  itemId: number;
  cantidad: number;
  pu: number | null;
  /** Ya comprado en órdenes no anuladas: la cantidad no puede quedar por debajo. */
  comprado: number;
};
export type ItemCatalogo = { id: number; descripcion: string; unidad: string; rubro?: string };

// Rubros para filtrar: los tres del presupuesto y el resto juntos.
const RUBROS = [
  { value: TODOS, label: "Todos" },
  { value: "MATERIAL", label: "Material" },
  { value: "MANO OBRA", label: "Mano de obra" },
  { value: "SUBCONTRATO", label: "Subcontrato" },
  { value: "OTROS", label: "Otros" },
];
const esAdicional = (requerimiento: string) => requerimiento !== "REGULAR";
/** «Regular» o «Adicional N» (no el código «ADIC N»). */
const nombreReq = (r: string) => nombreAdicional(r) ?? "Regular";
// La franja de la izquierda distingue las partidas adicionales en la lista y en la grilla.
const FRANJA_ADICIONAL = "shadow-[inset_4px_0_0_var(--color-warn)]";

type Fila = { key: string; id: number | null; etapa: string; requerimiento: string; itemId: number | null; cantidad: string; pu: string; comprado: number };

const aFila = (p: PartidaPresupuesto): Fila => ({
  key: `p${p.id}`,
  id: p.id,
  etapa: p.etapa,
  requerimiento: p.requerimiento,
  itemId: p.itemId,
  cantidad: String(p.cantidad),
  pu: p.pu == null ? "" : String(p.pu),
  comprado: p.comprado,
});

const igual = (a: Fila, b: Fila) =>
  a.etapa === b.etapa && a.requerimiento === b.requerimiento && a.itemId === b.itemId && Number(a.cantidad) === Number(b.cantidad) && a.pu === b.pu;

let nuevas = 0;

/**
 * Presupuesto editable de una obra. En escritorio es una grilla: Enter o las flechas ↑↓ pasan a la
 * misma columna de la fila vecina. En el celular, cada partida se edita en una hoja.
 */
export function EditorPresupuesto({
  obraId,
  partidas,
  items,
  etapas,
  requerimientos,
  editable,
}: {
  obraId: number;
  partidas: PartidaPresupuesto[];
  items: ItemCatalogo[];
  etapas: string[];
  requerimientos: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const originales = useMemo(() => new Map(partidas.map((p) => [p.id, aFila(p)])), [partidas]);
  const [filas, setFilas] = useState<Fila[]>(() => partidas.map(aFila));
  const [eliminadas, setEliminadas] = useState<number[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const item = new Map(items.map((i) => [i.id, i]));
  const opcionesItem = useMemo(() => items.map((i) => ({ value: String(i.id), label: i.descripcion, hint: i.unidad })), [items]);
  const opcionesEtapa = etapas.map((e) => ({ value: e, label: e }));
  const opcionesReq = requerimientos.map((r) => ({ value: r, label: nombreReq(r) }));

  // Filtros (en la pantalla: las partidas ya están cargadas). Las nuevas o cambiadas siempre se ven.
  const [q, setQ] = useState("");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const conAdicionales = [...new Set(partidas.map((p) => p.requerimiento))]
    .filter(esAdicional)
    .sort((a, b) => requerimientos.indexOf(a) - requerimientos.indexOf(b));
  const lista = (v?: string) => (v ?? "").split(",").filter((x) => x && x !== TODOS);

  const cambios = filas.filter((f) => f.id == null || !igual(f, originales.get(f.id)!));
  const sucio = cambios.length > 0 || eliminadas.length > 0;
  const total = filas.reduce((a, f) => a + (Number(f.cantidad) || 0) * (Number(f.pu) || 0), 0);

  const actualizar = (key: string, patch: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const agregar = () => {
    const key = `n${++nuevas}`;
    setFilas((fs) => [...fs, { key, id: null, etapa: fs.at(-1)?.etapa ?? etapas[0] ?? "", requerimiento: "REGULAR", itemId: null, cantidad: "", pu: "", comprado: 0 }]);
    return key;
  };
  const quitar = (f: Fila) => {
    if (f.comprado > 0) return setError("Esa partida ya tiene compras: no se puede quitar");
    setFilas((fs) => fs.filter((x) => x.key !== f.key));
    if (f.id != null) setEliminadas((e) => [...e, f.id!]);
  };
  const descartar = () => {
    setFilas(partidas.map(aFila));
    setEliminadas([]);
    setError(null);
  };

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const invalida = cambios.find((f) => !f.itemId || !f.etapa || !(Number(f.cantidad) >= 0) || f.cantidad === "");
      if (invalida) return setError("Completa etapa, ítem y cantidad de cada partida nueva o cambiada");
      const corta = cambios.find((f) => Number(f.cantidad) < f.comprado - 0.0001);
      if (corta) return setError(`${item.get(corta.itemId!)?.descripcion}: no puede quedar debajo de lo comprado (${qty(corta.comprado)})`);
      const payload: PartidaEdicion[] = cambios.map((f) => ({
        id: f.id,
        etapa: f.etapa,
        requerimiento: f.requerimiento,
        item_id: f.itemId!,
        cantidad: Number(f.cantidad),
        pu: f.pu === "" ? null : Number(f.pu),
      }));
      const r = await guardarPartidas(obraId, payload, eliminadas);
      if (!r.ok) return setError(r.error);
      setEliminadas([]);
      router.refresh();
    });

  // Grilla: Enter / ↑ ↓ mueven a la misma columna en la fila vecina.
  const mover = (e: KeyboardEvent<HTMLInputElement>, fila: number, col: string) => {
    const d = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" || e.key === "Enter" ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-celda="${fila + d}-${col}"]`)?.focus();
  };

  const filaEditando = filas.find((f) => f.key === editando);

  const reqSel = new Set(lista(filtros.req));
  const etapasSel = new Set(lista(filtros.etapa));
  const rubro = filtros.rubro ?? TODOS;
  const pu = filtros.pu ?? TODOS;
  const pasa = (f: Fila) => {
    if (f.id == null || !igual(f, originales.get(f.id)!)) return true;
    const it = f.itemId ? item.get(f.itemId) : null;
    if (q && !matches(it?.descripcion ?? "", q)) return false;
    if (reqSel.size && !reqSel.has(nombreReq(f.requerimiento))) return false;
    if (etapasSel.size && !etapasSel.has(f.etapa)) return false;
    if (rubro !== TODOS) {
      const r = it?.rubro ?? "";
      if (rubro === "OTROS" ? ["MATERIAL", "MANO OBRA", "SUBCONTRATO"].includes(r) : r !== rubro) return false;
    }
    if (pu === "sin" && f.pu !== "") return false;
    if (pu === "con" && f.pu === "") return false;
    return true;
  };
  const visibles = filas.filter(pasa);
  const filtrando = visibles.length !== filas.length;
  const totalVisible = visibles.reduce((a, f) => a + (Number(f.cantidad) || 0) * (Number(f.pu) || 0), 0);

  return (
    <>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ítem"
            aria-label="Buscar ítem"
            className={cn(inputClass, "pl-10")}
          />
        </div>
        <FiltrosHoja
          local={{ valores: filtros, onAplicar: setFiltros }}
          secciones={[
            ...(conAdicionales.length
              ? [{ tipo: "varias" as const, param: "req", titulo: "Requerimiento", opciones: ["Regular", ...conAdicionales.map(nombreReq)] }]
              : []),
            { tipo: "varias", param: "etapa", titulo: "Etapas", opciones: etapas.filter((e) => partidas.some((p) => p.etapa === e)) },
            { tipo: "opciones", param: "rubro", titulo: "Rubro", opciones: RUBROS },
            {
              tipo: "opciones",
              param: "pu",
              titulo: "P.U.",
              opciones: [
                { value: TODOS, label: "Todos" },
                { value: "sin", label: "Sin P.U." },
                { value: "con", label: "Con P.U." },
              ],
            },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="num text-ink-2">
          {filtrando ? `${visibles.length} de ${filas.length} partidas, S/ ${money(totalVisible)}` : `${filas.length} partidas, S/ ${money(total)}`}
        </span>
        {editable && (
          <Button
            variant="secondary"
            className="h-11 px-3"
            onClick={() => {
              const key = agregar();
              if (!window.matchMedia("(min-width: 1024px)").matches) setEditando(key);
            }}
          >
            <Plus size={18} /> Partida
          </Button>
        )}
      </div>
      {error && <p role="alert" className="px-1 text-danger">{error}</p>}

      {/* Celular: lista; cada partida se edita en una hoja */}
      <ul className="overflow-hidden rounded-panel bg-surface lg:hidden">
        {visibles.map((f) => {
          const it = f.itemId ? item.get(f.itemId) : null;
          const cambiada = f.id == null || !igual(f, originales.get(f.id)!);
          return (
            <li key={f.key} className="border-b border-line last:border-0">
              <button
                type="button"
                disabled={!editable}
                onClick={() => setEditando(f.key)}
                className={cn("block w-full px-4 py-3 text-left active:bg-ink/8", cambiada && "bg-warn-bg", esAdicional(f.requerimiento) && FRANJA_ADICIONAL)}
              >
                <div className="leading-snug">{it?.descripcion ?? "Elige el ítem"}</div>
                <div className="num mt-1 flex flex-wrap justify-between gap-x-3 text-sm text-ink-2">
                  <span className="flex gap-2">
                    <span>{f.etapa}</span>
                    <MarcaAdicional requerimiento={f.requerimiento} />
                  </span>
                  <span>
                    {qty(Number(f.cantidad) || 0)} {it?.unidad} ×{" "}
                    {f.pu === "" ? <span className="font-semibold text-warn">Sin P.U.</span> : money(Number(f.pu))}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
        {visibles.length === 0 && <li className="px-4 py-10 text-center text-ink-3">{filtrando ? "Sin partidas con esos filtros" : "Sin partidas"}</li>}
      </ul>

      {/* Escritorio: grilla */}
      <div role="grid" aria-label="Partidas del presupuesto" className="hidden overflow-hidden rounded-panel bg-surface lg:block">
        <div role="row" className="grid grid-cols-[6.5rem_8.5rem_1fr_6rem_7rem_7rem_3rem] border-b border-line text-[13px] font-medium text-ink-2">
          {["Etapa", "Requerimiento", "Ítem", "Cantidad", "P.U.", "Parcial", ""].map((h, i) => (
            <span key={i} role="columnheader" className={cn("px-2 py-2", i >= 3 && i <= 5 && "text-right")}>
              {h}
            </span>
          ))}
        </div>
        {visibles.map((f, idx) => {
          const it = f.itemId ? item.get(f.itemId) : null;
          const cambiada = f.id == null || !igual(f, originales.get(f.id)!);
          return (
            <div
              key={f.key}
              role="row"
              className={cn(
                "grid grid-cols-[6.5rem_8.5rem_1fr_6rem_7rem_7rem_3rem] items-center border-b border-line last:border-0",
                cambiada && "bg-warn-bg",
                esAdicional(f.requerimiento) && FRANJA_ADICIONAL,
              )}
            >
              <span role="gridcell" className="px-1 py-1">
                <SearchSelect label="Etapa" value={f.etapa} disabled={!editable} onChange={(v) => actualizar(f.key, { etapa: v })} options={opcionesEtapa} className="h-9 px-2 text-[14px]" />
              </span>
              <span role="gridcell" className="px-1 py-1">
                <SearchSelect
                  label="Requerimiento"
                  value={f.requerimiento}
                  disabled={!editable}
                  onChange={(v) => actualizar(f.key, { requerimiento: v })}
                  options={opcionesReq}
                  className={cn("h-9 px-2 text-[14px]", esAdicional(f.requerimiento) && "font-semibold text-warn")}
                />
              </span>
              <span role="gridcell" className="min-w-0 px-1 py-1">
                <SearchSelect
                  label="Ítem"
                  value={f.itemId ? String(f.itemId) : null}
                  disabled={!editable || f.comprado > 0}
                  onChange={(v) => actualizar(f.key, { itemId: Number(v) })}
                  options={opcionesItem}
                  className="h-9 px-2 text-[14px]"
                />
              </span>
              <span role="gridcell" className="px-1">
                <NumberInput
                  aria-label={`Cantidad ${it?.descripcion ?? ""}`}
                  data-celda={`${idx}-c`}
                  value={f.cantidad}
                  disabled={!editable}
                  onChange={(e) => actualizar(f.key, { cantidad: e.target.value })}
                  onKeyDown={(e) => mover(e, idx, "c")}
                  className={cn("h-9 text-[14px]", Number(f.cantidad) < f.comprado - 0.0001 && "border-danger")}
                />
              </span>
              <span role="gridcell" className="px-1">
                <NumberInput
                  aria-label={`P.U. ${it?.descripcion ?? ""}`}
                  data-celda={`${idx}-p`}
                  value={f.pu}
                  disabled={!editable}
                  onChange={(e) => actualizar(f.key, { pu: e.target.value })}
                  onKeyDown={(e) => mover(e, idx, "p")}
                  placeholder="Sin P.U."
                  className={cn("h-9 text-[14px]", f.pu === "" && "border-warn-line")}
                />
              </span>
              <span role="gridcell" className="num px-2 text-right text-[14px]">
                {money((Number(f.cantidad) || 0) * (Number(f.pu) || 0))}
              </span>
              <span role="gridcell" className="flex justify-center">
                {editable && (
                  <button
                    type="button"
                    aria-label="Quitar partida"
                    onClick={() => quitar(f)}
                    disabled={f.comprado > 0}
                    className="flex h-9 w-9 items-center justify-center rounded-control text-ink-3 hover:bg-ink/8 disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {editable && sucio && (
        <ActionBar>
          <Button variant="secondary" onClick={descartar} disabled={pending}>
            Descartar
          </Button>
          <Button className="flex-1" onClick={guardar} disabled={pending}>
            Guardar cambios ({cambios.length + eliminadas.length})
          </Button>
        </ActionBar>
      )}

      {filaEditando && (
        <Sheet
          open
          onClose={() => {
            if (filaEditando.id == null && !filaEditando.itemId) setFilas((fs) => fs.filter((x) => x.key !== filaEditando.key));
            setEditando(null);
          }}
          title={filaEditando.id ? "Partida" : "Partida nueva"}
          footer={
            <div className="flex gap-2">
              {filaEditando.comprado === 0 && (
                <Button
                  variant="secondary"
                  aria-label="Quitar partida"
                  onClick={() => {
                    quitar(filaEditando);
                    setEditando(null);
                  }}
                  className="w-12 px-0 text-danger"
                >
                  <Trash2 size={18} />
                </Button>
              )}
              <Button className="flex-1" size="lg" onClick={() => setEditando(null)}>
                Listo
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            <Field label="Ítem">
              <SearchSelect
                label="Ítem"
                value={filaEditando.itemId ? String(filaEditando.itemId) : null}
                disabled={filaEditando.comprado > 0}
                onChange={(v) => actualizar(filaEditando.key, { itemId: Number(v) })}
                options={opcionesItem}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Etapa">
                <SearchSelect label="Etapa" value={filaEditando.etapa} onChange={(v) => actualizar(filaEditando.key, { etapa: v })} options={opcionesEtapa} />
              </Field>
              <Field label="Requerimiento">
                <SearchSelect label="Requerimiento" value={filaEditando.requerimiento} onChange={(v) => actualizar(filaEditando.key, { requerimiento: v })} options={opcionesReq} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={filaEditando.comprado > 0 ? `Cantidad (mín. ${qty(filaEditando.comprado)})` : "Cantidad"}>
                <NumberInput value={filaEditando.cantidad} onChange={(e) => actualizar(filaEditando.key, { cantidad: e.target.value })} />
              </Field>
              <Field label="P.U.">
                <NumberInput value={filaEditando.pu} onChange={(e) => actualizar(filaEditando.key, { pu: e.target.value })} />
              </Field>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
