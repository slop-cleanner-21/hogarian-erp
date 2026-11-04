import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Barra de acciones fija inferior. `sobreNav` la coloca encima de la navegación
 * inferior (pantallas que la muestran); si no, ocupa el borde inferior.
 */
export function ActionBar({ children, sobreNav }: { children: ReactNode; sobreNav?: boolean }) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 border-t border-line bg-surface",
        sobreNav ? "bottom-[calc(4rem+env(safe-area-inset-bottom))]" : "pb-safe bottom-0",
      )}
    >
      <div className="mx-auto flex max-w-2xl gap-2 p-3">{children}</div>
    </div>
  );
}
