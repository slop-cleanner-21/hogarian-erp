"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { iniciarCarga } from "@/components/barra-carga";
import { IconoTodas, LogoEmpresa } from "@/components/logo-empresa";
import type { Option } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { UrlSelect } from "@/components/url-select";
import { cn } from "@/lib/format";

const TODAS = "todas";

/** Empresa (por su logo) y obra de la bandeja de Pagos, como en el presupuesto. */
export function EmpresaObra({
  empresas,
  empresa,
  obras,
  obra,
}: {
  empresas: { id: string; nombre: string }[];
  /** Id de la empresa o «todas». */
  empresa: string;
  obras: Option[];
  obra: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [hoja, setHoja] = useState(false);
  const actual = empresas.find((e) => e.id === empresa) ?? null;

  const elegirEmpresa = (id: string) => {
    setHoja(false);
    if (id === empresa) return;
    const next = new URLSearchParams(params.toString());
    next.set("empresa", id);
    // La obra elegida puede no ser de la otra empresa.
    next.delete("obra");
    next.delete("n");
    iniciarCarga();
    router.replace(`${path}?${next}`, { scroll: false });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setHoja(true)}
        aria-label={`Empresa: ${actual?.nombre ?? "todas"}`}
        className="flex h-12 w-14 shrink-0 items-center justify-center rounded-field border border-line bg-surface p-1 active:bg-sunken"
      >
        {actual ? <LogoEmpresa nombre={actual.nombre} className="h-full w-full" /> : <IconoTodas className="h-full w-full" />}
      </button>
      <div className="min-w-0 flex-1">
        <UrlSelect param="obra" label="Obra" value={obra} options={obras} />
      </div>
      {hoja && (
        <Sheet open onClose={() => setHoja(false)} title="Empresa">
          <ul className="grid grid-cols-2 gap-2 p-4">
            {[{ id: TODAS, nombre: "Todas" }, ...empresas].map((e) => {
              const elegida = e.id === (actual?.id ?? TODAS);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-pressed={elegida}
                    onClick={() => elegirEmpresa(e.id)}
                    className={cn(
                      "flex w-full flex-col items-center gap-2 rounded-panel border-2 bg-surface p-3 text-[15px] font-semibold active:bg-sunken",
                      elegida ? "border-primary" : "border-line",
                    )}
                  >
                    {e.id === TODAS ? <IconoTodas className="h-14 w-full" /> : <LogoEmpresa nombre={e.nombre} className="h-14 w-full" />}
                    {e.nombre}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </>
  );
}
