import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Barra de acciones fija inferior. `sobreNav` la coloca encima de la navegación
 * inferior (pantallas que la muestran); si no, ocupa el borde inferior.
 */
export function ActionBar({ children, sobreNav, arriba }: { children: ReactNode; sobreNav?: boolean; /** Sobre los botones (p. ej. lo que falta). */ arriba?: ReactNode }) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 border-t border-line bg-surface",
        sobreNav ? "bottom-[calc(4rem+env(safe-area-inset-bottom))]" : "pb-safe bottom-0",
      )}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2 p-3">
        {arriba}
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}
