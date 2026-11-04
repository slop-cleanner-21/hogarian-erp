"use client";

import { cn } from "@/lib/format";
import { inputClass } from "./ui/field";

/**
 * «Con observación» al registrar lo que llegó o lo avanzado (material dañado, imprevisto…).
 * `valor` es `null` sin observación; marcada, el texto es obligatorio.
 */
export function CampoObservacion({ valor, onChange }: { valor: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex min-h-11 items-center gap-3 text-[15px] font-medium">
        <input type="checkbox" checked={valor != null} onChange={(e) => onChange(e.target.checked ? "" : null)} className="h-5 w-5" />
        Con observación
      </label>
      {valor != null && (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          aria-label="Observación"
          placeholder="Material dañado, faltante, imprevisto…"
          className={cn(inputClass, "h-auto py-3")}
        />
      )}
    </div>
  );
}

/** Lista para enviar: sin observación, o con texto. */
export const observacionLista = (valor: string | null) => valor == null || valor.trim().length > 0;
