"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { PASO } from "@/lib/filtros";
import { cn } from "@/lib/format";
import { inputClass } from "./ui/field";

/** Búsqueda sincronizada con ?q= (u otro `param`), con debounce. */
export function SearchBox({ placeholder = "Buscar", param = "q" }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const qUrl = params.get(param) ?? "";
  const [q, setQ] = useState(qUrl);

  // Si la URL cambia desde fuera (p. ej. filtros restaurados), el campo la sigue.
  const [qUrlPrevio, setQUrlPrevio] = useState(qUrl);
  if (qUrl !== qUrlPrevio) {
    setQUrlPrevio(qUrl);
    setQ(qUrl);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get(param) ?? "") === q) return;
      const next = new URLSearchParams(params.toString());
      if (q) next.set(param, q);
      else next.delete(param);
      router.replace(`${path}?${next}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, param, params, path, router]);

  return (
    <div className="relative">
      <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(inputClass, "pl-10")}
      />
    </div>
  );
}

/** Pestañas segmentadas basadas en un parámetro de URL. */
export function Tabs({
  param,
  options,
  current,
  quitar = [],
  deslizable = false,
  porFila,
}: {
  param: string;
  options: { value: string; label: string; icon?: React.ReactNode }[];
  current: string;
  /** Parámetros que dejan de tener sentido al cambiar de pestaña (p. ej. un filtro de estado). */
  quitar?: string[];
  /** Muchas pestañas: la fila se desliza de lado (y la activa queda a la vista) en vez de repartir el ancho. */
  deslizable?: boolean;
  /** Pestañas por fila: con más, siguen en la fila de abajo (todas a la vista). */
  porFila?: number;
}) {
  const path = usePathname();
  const params = useSearchParams();
  // La pestaña tocada se marca al instante, sin esperar al servidor.
  const [tocada, setTocada] = useState<{ value: string; desde: string } | null>(null);
  const activa = tocada && tocada.desde === current ? tocada.value : current;
  const fila = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!deslizable) return;
    fila.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [deslizable, activa]);
  return (
    <div
      ref={fila}
      role="tablist"
      className={cn(
        "rounded-control bg-sunken p-1",
        deslizable ? "flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : cn("grid", porFila && "gap-1"),
      )}
      style={deslizable ? undefined : { gridTemplateColumns: `repeat(${porFila ?? options.length}, 1fr)` }}
    >
      {options.map((o) => {
        const next = new URLSearchParams(params.toString());
        next.set(param, o.value);
        if (o.value !== current) for (const q of quitar) next.delete(q);
        const active = o.value === activa;
        return (
          <Link
            key={o.value}
            role="tab"
            aria-selected={active}
            href={`${path}?${next}`}
            replace
            scroll={false}
            // Sin prefetch: la pestaña se marca al instante y el prefetch (solo el esqueleto en páginas dinámicas)
            // competía con lo que se ve en datos móviles.
            prefetch={false}
            onClick={() => setTocada({ value: o.value, desde: current })}
            className={cn(
              "flex h-11 items-center justify-center gap-1 whitespace-nowrap rounded-field text-[15px]",
              deslizable ? "shrink-0 px-3.5" : "px-1",
              active ? "bg-surface font-semibold" : "text-ink-2",
            )}
          >
            {o.icon}
            {/* Un salto de línea en el nombre lo parte en dos líneas (nombres largos en pestañas angostas). */}
            {o.label.includes("\n") ? <span className="whitespace-pre-line text-center leading-[1.15]">{o.label}</span> : o.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Scroll infinito: un marcador al final de la lista amplía el límite (?n=) cuando
 * entra en pantalla (con margen, antes de llegar al fondo). No se muestra si la
 * lista ya trajo todo lo que hay.
 */
export function VerMas({ visibles, limite }: { visibles: number; limite: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const marcador = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const hayMas = visibles >= limite;
  // Si mientras carga se toca un enlace, la recarga de la lista le ganaba a esa navegación: se guarda el
  // destino y se navega al terminar.
  const destino = useRef<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const alTocar = (ev: MouseEvent) => {
      const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.target) return;
      const url = new URL(a.href);
      if (url.origin === location.origin) destino.current = url.pathname + url.search;
    };
    document.addEventListener("click", alTocar, true);
    return () => document.removeEventListener("click", alTocar, true);
  }, [pending]);
  useEffect(() => {
    if (pending || !destino.current) return;
    const d = destino.current;
    destino.current = null;
    if (location.pathname + location.search !== d) router.push(d);
  }, [pending, router]);
  const siguiente = (() => {
    const next = new URLSearchParams(params.toString());
    next.set("n", String(limite + PASO));
    return `${path}?${next}`;
  })();

  useEffect(() => {
    const el = marcador.current;
    if (!el || !hayMas) return;
    let pedido = false;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || pedido) return;
        pedido = true;
        startTransition(() => router.replace(siguiente, { scroll: false }));
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hayMas, siguiente, router]);

  if (!hayMas) return null;
  return (
    <div ref={marcador} role="status" aria-live="polite" className="flex h-12 items-center justify-center text-sm text-ink-3">
      {pending ? "Cargando…" : ""}
    </div>
  );
}
