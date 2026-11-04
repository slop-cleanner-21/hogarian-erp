import { cn } from "@/lib/format";

/** «ADIC 15» → «Adicional 15»; una partida regular no tiene nombre de adicional (null). */
export const nombreAdicional = (requerimiento: string | null | undefined) =>
  requerimiento && requerimiento !== "REGULAR" ? requerimiento.replace(/^ADIC\b/, "Adicional") : null;

/** Etiqueta de una partida adicional (las regulares no llevan marca). */
export function MarcaAdicional({ requerimiento, className }: { requerimiento: string | null | undefined; className?: string }) {
  const nombre = nombreAdicional(requerimiento);
  return nombre ? (
    <span className={cn("inline-block whitespace-nowrap rounded-full bg-warn-bg px-2 text-[13px] font-semibold leading-5 text-warn", className)}>
      {nombre}
    </span>
  ) : null;
}
