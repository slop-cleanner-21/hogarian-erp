"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Faltan } from "@/components/ui/faltan";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, hoyISO, soles } from "@/lib/format";
import { anularAsientoManual, registrarAsientoManual } from "../actions";

type Cuenta = { codigo: string; denominacion: string };
type Fila = { cuenta: string | null; debe: string; haber: string };
const vacia = (): Fila => ({ cuenta: null, debe: "", haber: "" });
const num = (s: string) => Math.round((Number(s.replace(/,/g, "")) || 0) * 100) / 100;

/** Asiento manual: apertura, ventas, depósitos, planillas, ajustes. Cada línea en el Debe o en el Haber; cuadrado. */
export function NuevoAsiento({ empresaId, cuentas, fechaDefecto }: { empresaId: number; cuentas: Cuenta[]; fechaDefecto: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(fechaDefecto || hoyISO());
  const [glosa, setGlosa] = useState("");
  const [filas, setFilas] = useState<Fila[]>([vacia(), vacia()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const debe = Math.round(filas.reduce((a, f) => a + num(f.debe), 0) * 100) / 100;
  const haber = Math.round(filas.reduce((a, f) => a + num(f.haber), 0) * 100) / 100;
  const completas = filas.filter((f) => f.cuenta && (num(f.debe) > 0) !== (num(f.haber) > 0));
  const falta = [
    !glosa.trim() && "glosa",
    !fecha && "fecha",
    filas.some((f) => !f.cuenta) && "cuenta de cada línea",
    completas.length !== filas.length && "Debe o Haber en cada línea",
    filas.length < 2 && "dos líneas",
    debe !== haber && "que cuadre",
    !(debe > 0) && "montos",
  ];
  const cambiar = (i: number, f: Partial<Fila>) => setFilas((fs) => fs.map((x, k) => (k === i ? { ...x, ...f } : x)));
  const opciones = cuentas.map((c) => ({ value: c.codigo, label: `${c.codigo} ${c.denominacion}` }));

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await registrarAsientoManual({
        empresaId,
        fecha,
        glosa,
        lineas: filas.map((f) => ({ cuenta: f.cuenta!, debe: num(f.debe), haber: num(f.haber), glosa: null })),
      });
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      setGlosa("");
      setFilas([vacia(), vacia()]);
      router.refresh();
    });

  return (
    <>
      <Button
        aria-label="Nuevo asiento"
        onClick={() => setAbierto(true)}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Asiento
      </Button>
      {abierto && (
        <Sheet
          open
          onClose={() => setAbierto(false)}
          title="Nuevo asiento"
          full
          footer={
            <div className="flex flex-col gap-2">
              <div className="num flex justify-between text-[15px]">
                <span>Debe {soles(debe)}</span>
                <span className={cn(debe !== haber && "font-semibold text-danger")}>Haber {soles(haber)}</span>
              </div>
              <Faltan items={falta} />
              <Button size="lg" onClick={guardar} disabled={pending || falta.some(Boolean)}>
                Registrar asiento
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <Field label="Fecha">
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </Field>
              <Field label="Glosa">
                <Input value={glosa} onChange={(e) => setGlosa(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <ul aria-label="Líneas" className="flex flex-col gap-3">
              {filas.map((f, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchSelect
                        label={`Cuenta de la línea ${i + 1}`}
                        placeholder="Cuenta"
                        value={f.cuenta}
                        onChange={(v) => cambiar(i, { cuenta: v })}
                        multilinea
                        options={opciones}
                      />
                    </div>
                    {filas.length > 2 && (
                      <button
                        type="button"
                        aria-label={`Quitar la línea ${i + 1}`}
                        onClick={() => setFilas((fs) => fs.filter((_, k) => k !== i))}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Debe">
                      <NumberInput value={f.debe} onChange={(e) => cambiar(i, { debe: e.target.value, ...(e.target.value ? { haber: "" } : {}) })} />
                    </Field>
                    <Field label="Haber">
                      <NumberInput value={f.haber} onChange={(e) => cambiar(i, { haber: e.target.value, ...(e.target.value ? { debe: "" } : {}) })} />
                    </Field>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => setFilas((fs) => [...fs, vacia()])}>
              <Plus size={18} /> Línea
            </Button>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}

export function AnularAsiento({ id }: { id: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-label="Anular el asiento"
        onClick={() => setAbierto(true)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
      >
        <Trash2 size={18} />
      </button>
      <Confirm
        open={abierto}
        title="¿Anular el asiento?"
        danger
        pending={pending}
        onNo={() => setAbierto(false)}
        onYes={() =>
          startTransition(async () => {
            const r = await anularAsientoManual(id);
            if (!r.ok) return setError(r.error);
            setAbierto(false);
            router.refresh();
          })
        }
      >
        {error && <p className="text-danger">{error}</p>}
      </Confirm>
    </>
  );
}
