"use client";

import { Bell, SlidersHorizontal, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/format";
import { guardarPreferencia } from "./actions";

export type Preferencia = { tipo: string; label: string; area: string; avisar: boolean; celular: boolean };

/** Interruptor con su nombre (accesible como «switch»). */
function Interruptor({ label, icono: Icono, activo, disabled, onChange }: { label: string; icono: typeof Bell; activo: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!activo)}
      className="flex h-11 flex-1 items-center gap-2 rounded-control px-2 text-left text-[15px] active:bg-ink/8 disabled:opacity-40"
    >
      <Icono size={18} className={activo ? "text-primary" : "text-ink-3"} />
      <span className="flex-1">{label}</span>
      <span aria-hidden className={cn("flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors", activo ? "bg-primary" : "bg-ink-3/40")}>
        <span className={cn("h-5 w-5 rounded-full bg-surface shadow transition-transform", activo && "translate-x-4")} />
      </span>
    </button>
  );
}

/**
 * Qué avisos recibir y cuáles también al celular. Cada rol ve los suyos (ya activos); el Admin y Gerencia, además,
 * los de los demás (apagados), agrupados por área.
 */
export function PreferenciasAvisos({ eventos, agrupar }: { eventos: Preferencia[]; agrupar: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const [prefs, setPrefs] = useState(eventos);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const cambiar = (tipo: string, cambio: Partial<Pick<Preferencia, "avisar" | "celular">>) => {
    const antes = prefs;
    const actual = prefs.find((p) => p.tipo === tipo)!;
    const nuevo = { ...actual, ...cambio };
    // Sin avisar, tampoco al celular. Al empezar a avisar, el celular queda como estaba elegido (apagado si nunca).
    if (!nuevo.avisar) nuevo.celular = false;
    setPrefs(prefs.map((p) => (p.tipo === tipo ? nuevo : p)));
    startTransition(async () => {
      setError(null);
      const e = await guardarPreferencia(tipo, nuevo.avisar, nuevo.celular);
      if (e) {
        setError(e);
        setPrefs(antes);
      }
    });
  };

  const areas = agrupar ? [...new Set(prefs.map((p) => p.area))] : [""];
  return (
    <>
      <Button variant="secondary" onClick={() => setAbierta(true)}>
        <SlidersHorizontal size={18} /> Elegir avisos
      </Button>
      {abierta && (
        <Sheet open onClose={() => setAbierta(false)} title="Elegir avisos">
          <div className="flex flex-col gap-4 p-4">
            {areas.map((area) => (
              <section key={area || "todos"} aria-label={area || "Avisos"} className="flex flex-col">
                {area && <h3 className="rotulo pb-1 text-[17px] font-semibold text-ink-2">{area}</h3>}
                <ul className="flex flex-col">
                  {prefs
                    .filter((p) => !area || p.area === area)
                    .map((p) => (
                      <li key={p.tipo} aria-label={p.label} className="border-b border-line py-2 last:border-0">
                        <p className="text-[15px] font-medium">{p.label}</p>
                        <div className="flex gap-1">
                          <Interruptor label="Avisar" icono={Bell} activo={p.avisar} onChange={(v) => cambiar(p.tipo, { avisar: v })} />
                          <Interruptor label="Al celular" icono={Smartphone} activo={p.celular} disabled={!p.avisar} onChange={(v) => cambiar(p.tipo, { celular: v })} />
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
