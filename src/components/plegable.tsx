import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/** Sección que se despliega al tocar su título (etapas ya pasadas de una orden, historiales). */
export function Plegable({
  titulo,
  resumen,
  abierto = false,
  onToggle,
  children,
  className,
}: {
  titulo: ReactNode;
  /** A la derecha del título (un monto, una cantidad). */
  resumen?: ReactNode;
  abierto?: boolean;
  /** Al abrir o cerrar (solo desde un componente de cliente). */
  onToggle?: (abierto: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      open={abierto}
      onToggle={onToggle && ((e) => e.target === e.currentTarget && onToggle(e.currentTarget.open))}
      className={cn("rounded-panel bg-surface", className)}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="rotulo min-w-0 flex-1 text-[17px] font-semibold">{titulo}</span>
        {resumen != null && <span className="num shrink-0 text-[15px] text-ink-2">{resumen}</span>}
        {/* Gira según su propio <details>, no el de un plegable que lo contenga. */}
        <ChevronDown size={18} aria-hidden className="shrink-0 text-ink-3 transition-transform [details[open]>summary>&]:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}
