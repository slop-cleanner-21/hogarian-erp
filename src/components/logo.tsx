import { cn } from "@/lib/format";
import { MARCA_TRAZOS, MARCA_VIEWBOX } from "@/lib/marca";

/** Marca Hogarian (hexágono "HG") en el color de acción del tema; se adapta a claro/oscuro. */
export function Marca({ size = 40, className }: { size?: number; className?: string }) {
  const alto = Math.round((size * MARCA_VIEWBOX.h) / MARCA_VIEWBOX.w);
  return (
    <svg
      viewBox={`0 0 ${MARCA_VIEWBOX.w} ${MARCA_VIEWBOX.h}`}
      width={size}
      height={alto}
      aria-hidden
      fill="none"
      strokeLinejoin="miter"
      className={cn("shrink-0 stroke-primary", className)}
    >
      {MARCA_TRAZOS.map((t, i) => (
        <path key={i} d={t.d} strokeWidth={t.grosor} />
      ))}
    </svg>
  );
}

/** Logotipo completo: marca + "Grupo Hogarian", como el logo oficial. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-primary", className)} aria-label="Grupo Hogarian">
      <Marca size={46} />
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.08em]">GRUPO</span>
        <span className="text-[30px] font-bold tracking-[0.02em]">HOGARIAN</span>
      </div>
    </div>
  );
}
