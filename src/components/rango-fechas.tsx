"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";

/** Rango en fechas ISO (AAAA-MM-DD); `hasta` vacío mientras se elige. */
export type Rango = { desde: string; hasta: string | null };

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const MES = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/**
 * Calendario de un mes para elegir un rango: el primer toque marca el inicio y el segundo el fin
 * (si es anterior, se invierten). Las flechas cambian de mes.
 */
export function RangoFechas({ valor, onChange }: { valor: Rango | null; onChange: (r: Rango) => void }) {
  // Hoy en Lima (UTC-5), fijado al montar.
  const [hoy] = useState(() => iso(new Date(Date.now() - 5 * 3600_000)));
  const [mes, setMes] = useState(() => {
    const base = new Date(`${valor?.desde ?? hoy}T00:00:00Z`);
    return { y: base.getUTCFullYear(), m: base.getUTCMonth() };
  });

  const primero = utc(mes.y, mes.m, 1);
  const vacios = (primero.getUTCDay() + 6) % 7; // semana desde el lunes
  const dias = new Date(Date.UTC(mes.y, mes.m + 1, 0)).getUTCDate();
  const celdas = [...Array<null>(vacios).fill(null), ...Array.from({ length: dias }, (_, i) => iso(utc(mes.y, mes.m, i + 1)))];

  const mover = (n: number) => setMes(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  const tocar = (d: string) => {
    if (!valor || valor.hasta) return onChange({ desde: d, hasta: null });
    onChange(d < valor.desde ? { desde: d, hasta: valor.desde } : { desde: valor.desde, hasta: d });
  };
  const fin = valor?.hasta ?? valor?.desde;

  return (
    <div className="rounded-field border border-line p-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior" className="flex h-11 w-11 items-center justify-center rounded-control active:bg-ink/8">
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold first-letter:uppercase">{MES.format(primero)}</span>
        <button type="button" onClick={() => mover(1)} aria-label="Mes siguiente" className="flex h-11 w-11 items-center justify-center rounded-control active:bg-ink/8">
          <ChevronRight size={20} />
        </button>
      </div>
      <div role="grid" aria-label="Calendario" className="grid grid-cols-7 text-center">
        {DIAS.map((d, i) => (
          <span key={i} aria-hidden className="py-1 text-[13px] text-ink-3">
            {d}
          </span>
        ))}
        {celdas.map((d, i) => {
          if (!d) return <span key={`v${i}`} />;
          const extremo = d === valor?.desde || d === fin;
          const dentro = !!valor && !!fin && d > valor.desde && d < fin;
          return (
            <button
              key={d}
              type="button"
              onClick={() => tocar(d)}
              aria-pressed={extremo || dentro}
              aria-label={d.split("-").reverse().join("/")}
              className={cn(
                "num flex h-11 items-center justify-center text-[15px]",
                extremo ? "rounded-control bg-primary font-semibold text-primary-ink" : dentro ? "bg-primary/12" : "rounded-control active:bg-ink/8",
                d === hoy && !extremo && "font-semibold text-primary",
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
