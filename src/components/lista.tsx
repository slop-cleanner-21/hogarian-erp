import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Panel de lista con encabezado fijo. `columnas` usa el mismo `grid-template-columns`
 * que las filas; cada celda del encabezado puede listar (una por línea) los datos que
 * esa columna muestra en cada fila.
 */
export function Lista({
  encabezado,
  columnas = "grid-cols-[1fr_auto]",
  encabezadoFijo = true,
  children,
  className,
}: {
  encabezado: ReactNode[];
  /** Encabezado pegado bajo la barra superior al desplazar (no, si la pantalla ya fija sus filtros ahí). */
  encabezadoFijo?: boolean;
  columnas?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-panel bg-surface", className)}>
      <div
        role="row"
        className={cn(
          encabezadoFijo && "sticky top-15 z-10",
          "grid gap-x-4 rounded-t-panel border-b border-line bg-surface px-4 py-2 text-[13px] font-medium leading-tight text-ink-2",
          columnas,
        )}
      >
        {encabezado.map((h, i) => (
          <div key={i} role="columnheader" className={cn(i > 0 && "text-right")}>
            {h}
          </div>
        ))}
      </div>
      <ul className="[&>li:last-child]:rounded-b-panel [&>li]:overflow-hidden">{children}</ul>
    </section>
  );
}

/** Varias etiquetas apiladas en una celda de encabezado (una por línea de la fila). */
export function Pila({ children }: { children: ReactNode[] }) {
  return (
    <span className="flex flex-col">
      {children.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </span>
  );
}
