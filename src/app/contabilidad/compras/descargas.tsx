"use client";

import { Download, FileDown, FolderDown } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { soles } from "@/lib/format";

type Fila = { id: number; proveedor: string; comprobante: string; total: number; ple: boolean };

/**
 * Descarga del TXT del SIRE (registro de compras) y del ZIP de expedientes: solo los comprobantes de la lista filtrada, todos
 * marcados al abrir; se pueden desmarcar para bajar algunos en concreto.
 */
export function DescargasCompras({ filas, empresaId, periodo }: { filas: Fila[]; empresaId: string; periodo: string }) {
  const [open, setOpen] = useState(false);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  const abrir = () => {
    setMarcados(new Set(filas.map((f) => f.id)));
    setOpen(true);
  };
  const alternar = (id: number) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const elegidos = filas.filter((f) => marcados.has(f.id));
  const enPle = elegidos.filter((f) => f.ple).length;
  const qs = `empresa=${empresaId}&periodo=${periodo}&ids=${elegidos.map((f) => f.id).join(",")}`;
  const todos = elegidos.length === filas.length;

  if (filas.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-label="Descargar TXT o ZIP"
        className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
      >
        <Download size={22} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Descargar"
        full
        footer={
          <div className="grid grid-cols-2 gap-2">
            <a
              href={enPle ? `/contabilidad/ple?${qs}` : undefined}
              aria-disabled={!enPle}
              className="flex h-12 items-center justify-center gap-2 rounded-field border border-line font-semibold active:bg-ink/8 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              <FileDown size={19} /> TXT SIRE ({enPle})
            </a>
            <a
              href={elegidos.length ? `/contabilidad/expediente?${qs}` : undefined}
              aria-disabled={!elegidos.length}
              className="flex h-12 items-center justify-center gap-2 rounded-field bg-primary font-semibold text-primary-ink active:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              <FolderDown size={19} /> ZIP ({elegidos.length})
            </a>
          </div>
        }
      >
        <label className="flex min-h-12 items-center gap-3 border-b border-line px-4 font-semibold">
          <input
            type="checkbox"
            checked={todos}
            onChange={() => setMarcados(todos ? new Set() : new Set(filas.map((f) => f.id)))}
            className="h-5 w-5 accent-primary"
          />
          {todos ? "Todos" : `${elegidos.length} de ${filas.length}`}
        </label>
        <ul>
          {filas.map((f) => (
            <li key={f.id} className="border-b border-line last:border-0">
              <label className="grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-2">
                <input type="checkbox" checked={marcados.has(f.id)} onChange={() => alternar(f.id)} className="h-5 w-5 accent-primary" />
                <span className="min-w-0">
                  <span className="block truncate">{f.proveedor}</span>
                  <span className="num block text-sm text-ink-3">{f.comprobante}</span>
                </span>
                <span className="num text-right">{soles(f.total)}</span>
              </label>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
