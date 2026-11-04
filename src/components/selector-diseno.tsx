"use client";

import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  Coins,
  GalleryVerticalEnd,
  LayoutGrid,
  LayoutList,
  ListTree,
  Pin,
  Rows3,
  Store,
  Table2,
  Tags,
  type LucideIcon,
  SquareSigma,
  ArrowDownWideNarrow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { DISENOS_ITEMS, disenosDe, guardarDiseno, type PantallaDiseno } from "@/lib/diseno";
import { cn } from "@/lib/format";

type Tipo = "listas" | "items";

const ICONOS: Record<Tipo, Record<string, LucideIcon>> = {
  listas: {
    lista: LayoutList,
    compacta: Rows3,
    tarjetas: GalleryVerticalEnd,
    tabla: Table2,
    mosaico: LayoutGrid,
    obra: Building2,
    proveedor: Store,
    fecha: CalendarDays,
    empresa: Briefcase,
    etapa: ListTree,
    monto: Coins,
  },
  items: {
    lista: LayoutList,
    compacta: Rows3,
    tabla: Table2,
    tarjetas: GalleryVerticalEnd,
    etapa: ListTree,
    avance: BarChart3,
    precios: Tags,
    importe: ArrowDownWideNarrow,
    mosaico: LayoutGrid,
    resumen: SquareSigma,
  },
};

// ------------------------------------------------------------------ miniaturas: barras con la forma de cada diseño
const Barra = ({ className }: { className: string }) => <i className={cn("block h-1.5 shrink-0 rounded-full bg-ink-3/45", className)} />;
const Fuerte = ({ className }: { className: string }) => <i className={cn("block h-2 shrink-0 rounded-full bg-ink-2", className)} />;
const Panel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("flex flex-col rounded-[5px] bg-surface", className)}>{children}</span>
);

function FilaLista({ obra = true }: { obra?: boolean }) {
  return (
    <span className="flex justify-between gap-2 border-b border-line px-1.5 py-1.5 last:border-0">
      <span className="flex flex-col gap-1">
        <Fuerte className="w-8" />
        <Barra className="w-14" />
        {obra && <Barra className="w-10 bg-ink-3/25" />}
      </span>
      <span className="flex flex-col items-end gap-1">
        <Fuerte className="w-7" />
        <Barra className="w-5" />
      </span>
    </span>
  );
}

function FilaCompacta({ largo = "flex-1" }: { largo?: string }) {
  return (
    <span className="flex items-center gap-1.5 border-b border-line px-1.5 py-[5px] last:border-0">
      <Fuerte className="w-5" />
      <Barra className={largo} />
      <Fuerte className="w-5" />
    </span>
  );
}

/** Fila de tabla: columnas de anchos fijos. */
function FilaTabla({ cabecera = false }: { cabecera?: boolean }) {
  const B = cabecera ? Fuerte : Barra;
  return (
    <span className={cn("grid grid-cols-[1.25rem_1fr_1rem_1.5rem] items-center gap-1 border-b border-line px-1.5 py-1 last:border-0", cabecera && "bg-sunken/60")}>
      <B className="w-full" />
      <B className="w-4/5" />
      <B className="w-full" />
      <B className="w-full" />
    </span>
  );
}

function Grupo({ children, titulo, marca }: { children: ReactNode; titulo: string; marca?: ReactNode }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-1 px-0.5">
        <span className="flex items-center gap-1">
          {marca}
          <Fuerte className={titulo} />
        </span>
        <Barra className="w-5" />
      </span>
      <Panel>{children}</Panel>
    </span>
  );
}

function Mosaico() {
  return (
    <span className="grid grid-cols-2 gap-1">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="flex flex-col gap-1 rounded-[5px] bg-surface p-1">
          <span className="flex justify-between">
            <Fuerte className="w-4" />
            <Fuerte className="w-4" />
          </span>
          <Barra className="w-full" />
        </span>
      ))}
    </span>
  );
}

const MINIATURAS: Record<Tipo, Record<string, () => ReactNode>> = {
  listas: {
    lista: () => (
      <Panel>
        <FilaLista />
        <FilaLista />
        <FilaLista />
      </Panel>
    ),
    compacta: () => (
      <Panel>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <FilaCompacta key={i} />
        ))}
      </Panel>
    ),
    tarjetas: () => (
      <span className="flex flex-col gap-1.5">
        {[0, 1].map((i) => (
          <span key={i} className="flex flex-col gap-1 rounded-[5px] bg-surface p-1.5">
            <span className="flex justify-between gap-2">
              <Barra className="w-14" />
              <Fuerte className="h-2.5 w-9" />
            </span>
            <Barra className="w-12 bg-ink-3/25" />
            <span className="block h-1 overflow-hidden rounded-full bg-sunken">
              <i className={cn("block h-full rounded-full bg-primary", i ? "w-full" : "w-2/5")} />
            </span>
          </span>
        ))}
      </span>
    ),
    tabla: () => (
      <Panel>
        <FilaTabla cabecera />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <FilaTabla key={i} />
        ))}
      </Panel>
    ),
    mosaico: () => <Mosaico />,
    obra: () => (
      <span className="flex flex-col gap-1.5">
        <Grupo titulo="w-12">
          <FilaLista obra={false} />
          <FilaLista obra={false} />
        </Grupo>
        <Grupo titulo="w-9">
          <FilaLista obra={false} />
        </Grupo>
      </span>
    ),
    proveedor: () => (
      <span className="flex flex-col gap-1.5">
        <Grupo titulo="w-14">
          <FilaCompacta />
          <FilaCompacta />
          <FilaCompacta />
        </Grupo>
        <Grupo titulo="w-10">
          <FilaCompacta />
          <FilaCompacta />
        </Grupo>
      </span>
    ),
    fecha: () => (
      <span className="flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <Grupo key={i} titulo="w-7" marca={<i className="block h-2.5 w-2.5 rounded-[3px] border-2 border-ink-2" />}>
            <FilaCompacta />
            {i === 0 && <FilaCompacta />}
          </Grupo>
        ))}
      </span>
    ),
    empresa: () => (
      <span className="flex flex-col gap-1.5">
        {[0, 1].map((i) => (
          <Grupo key={i} titulo="w-10" marca={<i className="block h-3 w-4 rounded-[3px] bg-primary/70" />}>
            <FilaCompacta largo="w-8" />
            <FilaCompacta largo="w-10" />
          </Grupo>
        ))}
      </span>
    ),
    etapa: () => (
      <span className="flex flex-col gap-1.5">
        {["w-5", "w-6"].map((w, i) => (
          <Grupo key={i} titulo={w} marca={<i className="block h-3 w-3 rounded-[3px] bg-ink-2/70" />}>
            <FilaCompacta />
            <FilaCompacta largo={i ? "w-10" : "flex-1"} />
          </Grupo>
        ))}
      </span>
    ),
    monto: () => (
      <span className="flex flex-col gap-1.5">
        {["w-12", "w-8", "w-4"].map((w, i) => (
          <Grupo key={i} titulo={w} marca={<i className={cn("block h-2.5 rounded-sm bg-primary", ["w-3", "w-2", "w-1"][i])} />}>
            <FilaCompacta />
          </Grupo>
        ))}
      </span>
    ),
  },
  items: {
    lista: () => (
      <Panel>
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex flex-col gap-1 border-b border-line px-1.5 py-1.5 last:border-0">
            <Barra className="w-14" />
            <span className="flex justify-between">
              <Barra className="w-10 bg-ink-3/25" />
              <Fuerte className="w-7" />
            </span>
          </span>
        ))}
      </Panel>
    ),
    compacta: () => (
      <Panel>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="flex items-center gap-1.5 border-b border-line px-1.5 py-[5px] last:border-0">
            <Barra className="flex-1" />
            <Barra className="w-3" />
            <Fuerte className="w-6" />
          </span>
        ))}
      </Panel>
    ),
    tabla: () => (
      <Panel>
        <FilaTabla cabecera />
        {[0, 1, 2, 3, 4].map((i) => (
          <FilaTabla key={i} />
        ))}
      </Panel>
    ),
    tarjetas: () => (
      <span className="flex flex-col gap-1.5">
        {[0, 1].map((i) => (
          <span key={i} className="flex flex-col gap-1 rounded-[5px] bg-surface p-1.5">
            <Barra className="w-16" />
            <span className="flex items-end justify-between">
              <Barra className="w-8 bg-ink-3/25" />
              <Fuerte className="h-2.5 w-10" />
            </span>
          </span>
        ))}
      </span>
    ),
    etapa: () => (
      <span className="flex flex-col gap-1.5">
        {[0, 1].map((i) => (
          <Grupo key={i} titulo={i ? "w-5" : "w-6"}>
            <FilaCompacta largo="w-14" />
            <FilaCompacta largo="w-12" />
          </Grupo>
        ))}
      </span>
    ),
    avance: () => (
      <Panel>
        {["w-full", "w-3/5", "w-1/4"].map((w, i) => (
          <span key={i} className="flex flex-col gap-1 border-b border-line px-1.5 py-1.5 last:border-0">
            <span className="flex justify-between">
              <Barra className="w-12" />
              <Fuerte className="w-6" />
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-sunken">
              <i className={cn("block h-full rounded-full bg-primary", w)} />
            </span>
          </span>
        ))}
      </Panel>
    ),
    precios: () => (
      <Panel>
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex flex-col gap-1 border-b border-line px-1.5 py-1.5 last:border-0">
            <span className="flex justify-between">
              <Barra className="w-12" />
              <Fuerte className="w-5" />
            </span>
            <span className="flex gap-1">
              {["bg-ok/50", "bg-warn/50", "bg-ink-3/40"].map((c) => (
                <i key={c} className={cn("block h-2 w-4 rounded-[3px]", c)} />
              ))}
            </span>
          </span>
        ))}
      </Panel>
    ),
    importe: () => (
      <Panel>
        {["w-full", "w-2/3", "w-2/5", "w-1/4", "w-1/6"].map((w, i) => (
          <span key={i} className="flex items-center gap-1.5 border-b border-line px-1.5 py-[5px] last:border-0">
            <span className="flex-1">
              <i className={cn("block h-2 rounded-sm bg-primary/60", w)} />
            </span>
            <Fuerte className="w-5" />
          </span>
        ))}
      </Panel>
    ),
    mosaico: () => <Mosaico />,
    resumen: () => (
      <span className="flex flex-col gap-1.5">
        <span className="flex flex-col items-center gap-1 rounded-[5px] bg-surface p-2">
          <Barra className="w-8" />
          <Fuerte className="h-3 w-16" />
        </span>
        <span className="grid grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-col items-center gap-1 rounded-[5px] bg-surface p-1">
              <Barra className="w-5" />
              <Fuerte className="w-6" />
            </span>
          ))}
        </span>
        <Panel>
          <FilaCompacta />
        </Panel>
      </span>
    ),
  },
};

/**
 * Botón de la barra superior para cambiar el diseño de una lista o de los ítems de una orden (con una
 * miniatura de cada uno) y, en las listas, fijar arriba los filtros y el buscador. Se recuerda en el
 * dispositivo, por pantalla.
 */
export function SelectorDiseno({
  pantalla,
  tipo = "listas",
  actual,
  fijo = null,
}: {
  pantalla: PantallaDiseno;
  tipo?: Tipo;
  actual: string;
  /** null: la pantalla no tiene filtros que fijar. */
  fijo?: boolean | null;
}) {
  const router = useRouter();
  const opciones: readonly { value: string; label: string }[] = tipo === "items" ? DISENOS_ITEMS : disenosDe(pantalla);
  const [hoja, setHoja] = useState(false);
  const [elegido, setElegido] = useState({ diseno: actual, fijo });
  const [cargando, startTransition] = useTransition();
  const Icono = ICONOS[tipo][elegido.diseno] ?? LayoutList;

  const elegir = (cambio: Partial<typeof elegido>, cerrar = true) => {
    if (cerrar) setHoja(false);
    const nuevo = { ...elegido, ...cambio };
    if (nuevo.diseno === elegido.diseno && nuevo.fijo === elegido.fijo) return;
    setElegido(nuevo);
    guardarDiseno(pantalla, nuevo.diseno, nuevo.fijo);
    startTransition(() => router.refresh());
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setHoja(true)}
        aria-label={`Diseño: ${opciones.find((d) => d.value === elegido.diseno)?.label ?? ""}`}
        className={cn("flex h-12 w-10 items-center justify-center rounded-control active:bg-ink/8", cargando && "opacity-50")}
      >
        <Icono size={21} />
      </button>
      {hoja && (
        <Sheet open onClose={() => setHoja(false)} title="Diseño">
          <div role="radiogroup" aria-label="Diseño" className="grid grid-cols-2 gap-2 p-3">
            {opciones.map((d) => {
              const I = ICONOS[tipo][d.value] ?? LayoutList;
              const activo = d.value === elegido.diseno;
              return (
                <button
                  key={d.value}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  aria-label={d.label}
                  onClick={() => elegir({ diseno: d.value })}
                  className={cn(
                    "flex flex-col gap-2 rounded-panel border-2 bg-surface p-2 text-left active:bg-sunken",
                    activo ? "border-primary" : "border-line",
                  )}
                >
                  <span
                    aria-hidden
                    data-miniatura={d.value}
                    className="block h-[7.5rem] w-full overflow-hidden rounded-field bg-sunken p-1.5"
                  >
                    {MINIATURAS[tipo][d.value]?.()}
                  </span>
                  <span className={cn("flex items-center gap-2 px-1 pb-0.5 text-[15px]", activo && "font-semibold")}>
                    <I size={18} className={cn("shrink-0", activo ? "text-primary" : "text-ink-2")} />
                    {d.label}
                  </span>
                </button>
              );
            })}
          </div>
          {fijo != null && (
            <div className="border-t border-line p-3">
              <button
                type="button"
                role="switch"
                aria-checked={!!elegido.fijo}
                onClick={() => elegir({ fijo: !elegido.fijo }, false)}
                className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left active:bg-ink/8"
              >
                <Pin size={20} className={elegido.fijo ? "text-primary" : "text-ink-2"} />
                <span className="flex-1 text-[15px]">Fijar filtros arriba</span>
                <span
                  aria-hidden
                  className={cn("flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors", elegido.fijo ? "bg-primary" : "bg-ink-3/40")}
                >
                  <span className={cn("h-6 w-6 rounded-full bg-surface shadow transition-transform", elegido.fijo && "translate-x-5")} />
                </span>
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
