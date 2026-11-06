"use client";

import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn, matches, norm } from "@/lib/format";
import { inputClass } from "./field";
import { Sheet } from "./sheet";

/**
 * `marca`: etiqueta corta y visible en la opción (p. ej. "Ya vendió 3"); también se busca por ella.
 * `detalle`: lo que la opción despliega como acordeón (p. ej. qué ítems vendió el proveedor).
 */
export type Option = { value: string; label: string; hint?: string; marca?: string; detalle?: ReactNode };

/** Fila "+ label" al final de la lista para crear lo que no está; recibe lo buscado. */
export type Crear = { label: string; onCrear: (texto: string) => void };

const MAX_VISIBLE = 80;

/** Hoja de selección con buscador (controlada). */
export function SearchSheet({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
  crear,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  crear?: Crear;
}) {
  const [q, setQ] = useState("");
  // Acordeones: si alguna opción trae detalle, se despliega con su flecha.
  const verDetalle = options.some((o) => o.detalle != null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, MAX_VISIBLE);
    const buscado = norm(q.trim());
    const peso = (o: Option) => {
      const l = norm(o.label);
      return l === buscado ? 0 : l.startsWith(buscado) ? 1 : 2;
    };
    return options
      .filter((o) => matches(`${o.label} ${o.hint ?? ""} ${o.marca ?? ""}`, q))
      .map((o, i) => ({ o, i, p: peso(o) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .slice(0, MAX_VISIBLE)
      .map((x) => x.o);
  }, [options, q]);

  const close = () => {
    setQ("");
    onClose();
  };

  const elegir = (v: string) => {
    onChange(v);
    close();
  };

  return (
    <Sheet open={open} onClose={close} title={title} full>
      <div className="sticky top-0 z-10 bg-surface p-3">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            data-autofocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            aria-label={`Buscar ${title}`}
            className={cn(inputClass, "pl-10")}
          />
        </div>
      </div>
      <ul role="listbox" aria-label={title} className="pb-safe">
        {crear && (
          <li>
            <button
              type="button"
              onClick={() => {
                const texto = q.trim();
                close();
                crear.onCrear(texto);
              }}
              className="flex min-h-13 w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left font-semibold text-primary active:bg-ink/8"
            >
              <Plus size={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{q.trim() ? `${crear.label} «${q.trim()}»` : crear.label}</span>
            </button>
          </li>
        )}
        {filtered.map((o) => (
          <li key={o.value} className={cn(verDetalle && "border-b border-line")}>
            <div className="flex items-stretch">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => elegir(o.value)}
                className={cn(
                  "flex min-h-13 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left active:bg-ink/8",
                  !verDetalle && "border-b border-line",
                  verDetalle && o.detalle != null && "pr-1",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block">{o.label}</span>
                  {o.hint && <span className="block text-sm text-ink-3">{o.hint}</span>}
                </span>
                {o.marca && (
                  <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 text-[13px] font-semibold text-primary">{o.marca}</span>
                )}
                {o.value === value && <Check size={18} />}
              </button>
              {verDetalle && o.detalle != null && (
                <button
                  type="button"
                  aria-label={`Detalle de ${o.label}`}
                  aria-expanded={abierta === o.value}
                  onClick={() => setAbierta(abierta === o.value ? null : o.value)}
                  className="flex w-12 shrink-0 items-center justify-center text-ink-2 active:bg-ink/8"
                >
                  <ChevronDown size={20} className={cn("transition-transform", abierta === o.value && "rotate-180")} />
                </button>
              )}
            </div>
            {verDetalle && abierta === o.value && (
              <div className="flex flex-col gap-2 px-4 pb-3 pt-1">
                {o.detalle}
                <button
                  type="button"
                  aria-label={`Elegir ${o.label}`}
                  onClick={() => elegir(o.value)}
                  className="h-11 rounded-control bg-primary px-4 font-semibold text-primary-ink active:opacity-90"
                >
                  Elegir
                </button>
              </div>
            )}
          </li>
        ))}
        {filtered.length === 0 && !crear && <li className="px-4 py-6 text-center text-ink-3">Sin resultados</li>}
      </ul>
    </Sheet>
  );
}

/** Desplegable con buscador obligatorio. */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Seleccionar",
  name,
  disabled,
  className,
  crear,
  multilinea,
}: {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  /** Lo elegido en hasta 2 líneas en vez de cortarlo en una (etiquetas largas en un selector a todo el ancho). */
  multilinea?: boolean;
  disabled?: boolean;
  className?: string;
  crear?: Crear;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cn(inputClass, "flex items-center gap-2 text-left disabled:opacity-50", multilinea && "h-auto min-h-12 py-2 leading-snug", className)}
      >
        <span className={cn("min-w-0 flex-1", multilinea ? "line-clamp-2" : "truncate", !selected && "text-ink-3")}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={18} className="shrink-0 text-ink-3" />
      </button>
      {/* Fuera del árbol: Field es un <label>, y un clic dentro de un label se reenvía a su control (este botón). En Samsung
          Internet cada toque en la hoja la cerraba y ese clic la reabría al instante: parecía que nada respondía. */}
      {open &&
        createPortal(
          <SearchSheet
            open
            onClose={() => setOpen(false)}
            title={label}
            options={options}
            value={value}
            onChange={onChange}
            crear={crear}
          />,
          document.body,
        )}
    </>
  );
}
