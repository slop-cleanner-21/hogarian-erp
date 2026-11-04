"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";

/** Copia al portapapeles; sin contexto seguro (http en la red local) usa un campo oculto. */
export async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: texto });
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Botón de copiar con confirmación (✓) o error (✕) durante un momento. */
export function BotonCopiar({ valor, label, className }: { valor: string; label: string; className?: string }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  return (
    <button
      type="button"
      aria-label={`Copiar ${label}`}
      onClick={async () => {
        setCopiado(await copiarTexto(valor));
        setTimeout(() => setCopiado(null), 1500);
      }}
      className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8", className)}
    >
      {copiado === true ? <Check size={18} className="text-ok" /> : copiado === false ? <X size={18} className="text-danger" /> : <Copy size={18} />}
    </button>
  );
}

/**
 * Dato con su botón de copiar. `copia` es lo que va al portapapeles si difiere de lo que se ve
 * (p. ej. un monto sin formato).
 */
/** `sinCopia`: datos que en SUNAT se eligen (no se pegan). */
export function Dato({ label, valor, copia, multilinea, sinCopia }: { label: string; valor: string; copia?: string; multilinea?: boolean; sinCopia?: boolean }) {
  return (
    <div className="flex items-start gap-2 border-b border-line py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-3">{label}</div>
        <div className={cn("num break-words", multilinea && "whitespace-pre-line")}>{valor}</div>
      </div>
      {!sinCopia && valor && valor !== "—" && <BotonCopiar valor={copia ?? valor} label={label} />}
    </div>
  );
}
