"use client";

import { Lock, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { SearchSelect } from "@/components/ui/search-select";
import { money } from "@/lib/format";
import { asignarPersonaObra, cerrarObra, publicarPresupuesto, reemplazarResidente } from "./actions";

const CARGO: Record<string, string> = {
  RESIDENTE: "Residente",
  OTRO: "Otro",
};

/** Publicar el presupuesto: desde ahí solo Gerencia lo cambia. */
export function PublicarPresupuesto({
  obraId,
  vacio,
}: {
  obraId: number;
  vacio: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button onClick={() => setAbierto(true)} disabled={vacio || pending}>
        <Send size={18} /> Publicar presupuesto
      </Button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Confirm
        open={abierto}
        title="¿Publicar el presupuesto?"
        onNo={() => setAbierto(false)}
        pending={pending}
        onYes={() =>
          startTransition(async () => {
            const r = await publicarPresupuesto(obraId);
            setAbierto(false);
            if (!r.ok) return setError(r.error);
            router.refresh();
          })
        }
      >
        <p className="text-ink-2">Operaciones recibe el aviso y empieza el seguimiento.</p>
      </Confirm>
    </div>
  );
}

type Persona = { id: number; nombre: string; cargo: string };

/** Residentes asignados a la obra (personas activas de RRHH). Sin `editable`, solo consulta. */
export function PersonasObra({
  obraId,
  asignadas,
  disponibles,
  editable = true,
  titulo = "Personas",
}: {
  obraId: number;
  asignadas: Persona[];
  disponibles: Persona[];
  editable?: boolean;
  titulo?: string;
}) {
  const asignables = disponibles;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Quién se quita (abre la confirmación) y, si es residente, quién lo reemplaza.
  const [quitar, setQuitar] = useState<Persona | null>(null);
  const [reemplazo, setReemplazo] = useState<string | null>(null);
  const cambiar = (personaId: number, asignar: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await asignarPersonaObra(obraId, personaId, asignar);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  const esResidente = quitar?.cargo === "RESIDENTE";
  // El cargo solo informa si hay residentes y otras personas.
  const mixtas = new Set([...asignadas, ...disponibles].map((p) => p.cargo)).size > 1;
  const reemplazos = [
    ...asignadas.filter((p) => p.cargo === "RESIDENTE" && p.id !== quitar?.id).map((p) => ({ value: String(p.id), label: p.nombre, hint: "Ya está en la obra" })),
    ...disponibles.filter((p) => p.cargo === "RESIDENTE").map((p) => ({ value: String(p.id), label: p.nombre })),
  ];
  const cerrar = () => {
    setQuitar(null);
    setReemplazo(null);
  };
  const confirmar = () =>
    startTransition(async () => {
      if (!quitar) return;
      setError(null);
      const r = esResidente ? await reemplazarResidente(obraId, quitar.id, Number(reemplazo)) : await asignarPersonaObra(obraId, quitar.id, false);
      cerrar();
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <section
      aria-label="Personas de la obra"
      className="flex flex-col gap-2 rounded-panel bg-surface p-3"
    >
      <h2 className="rotulo px-1 text-[17px] font-semibold">{titulo}</h2>
      {!editable && asignadas.length === 0 && <p className="px-1 text-ink-3">Sin residentes</p>}
      {asignadas.length > 0 && (
        <ul>
          {asignadas.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 border-b border-line py-1.5 pl-1 last:border-0"
            >
              <Avatar semilla={`persona-${p.id}`} nombre={p.nombre} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.nombre}</span>
                {mixtas && <span className="block text-sm text-ink-3">{CARGO[p.cargo] ?? p.cargo}</span>}
              </span>
              {editable && (
                <button
                  type="button"
                  aria-label={`Quitar a ${p.nombre} de la obra`}
                  onClick={() => setQuitar(p)}
                  disabled={pending}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                >
                  <X size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
      <SearchSelect
        label="Asignar persona"
        placeholder="Asignar persona"
        value={null}
        disabled={pending || asignables.length === 0}
        onChange={(v) => cambiar(Number(v), true)}
        options={asignables.map((p) => ({
          value: String(p.id),
          label: p.nombre,
          hint: CARGO[p.cargo] ?? p.cargo,
        }))}
      />
      )}
      {error && (
        <p role="alert" className="px-1 text-danger">
          {error}
        </p>
      )}
      <Confirm
        open={quitar != null}
        title={`¿Quitar a ${quitar?.nombre ?? ""}?`}
        onNo={cerrar}
        onYes={confirmar}
        pending={pending}
        danger
        disabled={esResidente && !reemplazo}
      >
        {esResidente &&
          (reemplazos.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] font-medium text-ink-2">Lo reemplaza</span>
              <SearchSelect label="Lo reemplaza" placeholder="Elige al residente" value={reemplazo} onChange={setReemplazo} options={reemplazos} />
            </div>
          ) : (
            <p className="text-danger">No hay otro residente para reemplazarlo: RRHH debe registrar uno.</p>
          ))}
      </Confirm>
    </section>
  );
}

/**
 * Cerrar la obra (Gerencia): se da de baja todo lo que falta de cada partida y ya no se requiere,
 * ordena ni avanza nada más. La retención acumulada se paga después en una sola OS.
 */
export function CerrarObra({ obraId, partidas, monto, retencion }: { obraId: number; partidas: number; monto: number; retencion: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button variant="secondary" onClick={() => setAbierto(true)} disabled={pending}>
        <Lock size={18} /> Cerrar obra
      </Button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Confirm
        open={abierto}
        title="¿Cerrar la obra?"
        danger
        onNo={() => setAbierto(false)}
        pending={pending}
        onYes={() =>
          startTransition(async () => {
            const r = await cerrarObra(obraId);
            setAbierto(false);
            if (!r.ok) return setError(r.error);
            router.refresh();
          })
        }
      >
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[15px]">
          <dt className="text-ink-2">Partidas con saldo que se dan de baja</dt>
          <dd className="text-right">{partidas}</dd>
          <dt className="text-ink-2">Monto que se da de baja</dt>
          <dd className="text-right">S/ {money(monto)}</dd>
          <dt className="text-ink-2">Retención por pagar</dt>
          <dd className="text-right">S/ {money(retencion)}</dd>
        </dl>
      </Confirm>
    </div>
  );
}
