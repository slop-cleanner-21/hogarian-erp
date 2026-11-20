"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { HojaAdicional } from "@/app/presupuesto/adicionales";
import { MarcaAdicional } from "@/components/marca-adicional";
import { Plegable } from "@/components/plegable";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { cn, fecha, qty, soles } from "@/lib/format";
import { pedirAdicional, resolverAdicionales, type ResultadoResolucion } from "./actions";

export type Solicitud = {
  id: number;
  obra: string;
  motivo: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  requerimiento: string | null;
  respuesta: string | null;
  solicitante: string;
  solicitadoAt: string;
  resolvio: string | null;
  resueltoAt: string | null;
  partidas: { id: number; etapa: string; descripcion: string; unidad: string; cantidad: number; pu: number }[];
  total: number;
};

/**
 * Las solicitudes filtradas, con su total. `aprobar` (Gerencia): aprobar o rechazar cada una, o aprobar todas las por
 * aprobar de lo filtrado de una vez.
 */
export function ListaSolicitudes({ solicitudes, aprobar, conEstado }: { solicitudes: Solicitud[]; aprobar: boolean; /** En «Todas»: cada una dice su estado. */ conEstado: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState<{ ids: number[]; aprobar: boolean; titulo: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<{ error?: string; r?: ResultadoResolucion; aprobar?: boolean } | null>(null);
  const porAprobar = solicitudes.filter((s) => s.estado === "PENDIENTE");
  const total = solicitudes.reduce((a, s) => a + s.total, 0);

  const resolver = () =>
    startTransition(async () => {
      if (!confirmar) return;
      const r = await resolverAdicionales({ ids: confirmar.ids, aprobar: confirmar.aprobar, respuesta: confirmar.aprobar ? null : motivo });
      setResultado(r.ok ? { r: r.data, aprobar: confirmar.aprobar } : { error: r.error });
      setConfirmar(null);
      setMotivo("");
      router.refresh();
    });

  // Lo que pasó al aprobar o rechazar: se ve aunque la lista quede vacía (al aprobar todas).
  const aviso = resultado && (
    <div
      role="status"
      className={cn(
        "rounded-field px-3 py-2 text-[15px]",
        resultado.error || resultado.r?.errores.length ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok",
      )}
    >
      {resultado.error ??
        `${resultado.r!.hechas} ${resultado.aprobar ? "aprobada(s)" : "rechazada(s)"}${resultado.r!.errores.length ? `; no se pudo con ${resultado.r!.errores.length}` : ""}`}
      {resultado.r?.errores.map((e) => (
        <span key={e.id} className="block">
          {solicitudes.find((s) => s.id === e.id)?.obra ?? `N° ${e.id}`}: {e.error}
        </span>
      ))}
    </div>
  );

  if (solicitudes.length === 0)
    return (
      <div className="flex flex-col gap-3">
        {aviso}
        <p className="py-10 text-center text-ink-3">Sin solicitudes</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {aviso}
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-ink-2">{solicitudes.length} solicitud(es)</span>
        <span className="num font-semibold">{soles(total)}</span>
      </div>
      {aprobar && porAprobar.length > 1 && (
        <Button
          onClick={() =>
            setConfirmar({
              ids: porAprobar.map((s) => s.id),
              aprobar: true,
              titulo: `¿Aprobar las ${porAprobar.length} solicitudes?`,
            })
          }
        >
          Aprobar todas ({porAprobar.length}) · {soles(porAprobar.reduce((a, s) => a + s.total, 0))}
        </Button>
      )}
      <ul className="flex flex-col gap-3">
        {solicitudes.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 rounded-panel bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold leading-snug">{s.obra}</span>
                <span className="num block text-[14px] text-ink-3">
                  {s.solicitante}, {fecha(s.solicitadoAt)}
                </span>
              </span>
              <span className="num shrink-0 text-right">
                <span className="block font-semibold">{soles(s.total)}</span>
                <Estado s={s} conEstado={conEstado} />
              </span>
            </div>
            <p className="leading-snug [overflow-wrap:anywhere]">{s.motivo}</p>
            {s.estado === "RECHAZADA" && s.respuesta && (
              <p className="rounded-field bg-danger-bg px-3 py-2 text-[15px] leading-snug text-danger">
                {s.respuesta}
                <span className="num block text-[13px]">
                  {s.resolvio}, {fecha(s.resueltoAt)}
                </span>
              </p>
            )}
            {s.estado === "APROBADA" && (
              <p className="num text-[14px] text-ink-3">
                Aprobó {s.resolvio}, {fecha(s.resueltoAt)}
              </p>
            )}
            <Plegable titulo={<span className="text-[15px] font-normal text-ink-2">{s.partidas.length} partida(s)</span>}>
              <ul className="overflow-hidden rounded-field border border-line">
                {s.partidas.map((p) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line px-3 py-2 last:border-0">
                    <span className="leading-snug">{p.descripcion}</span>
                    <span className="num text-right font-semibold">{soles(p.cantidad * p.pu)}</span>
                    <span className="text-[14px] text-ink-3">{p.etapa}</span>
                    <span className="num text-right text-[14px] text-ink-3">
                      {qty(p.cantidad)} {p.unidad} × {soles(p.pu)}
                    </span>
                  </li>
                ))}
              </ul>
            </Plegable>
            {aprobar && s.estado === "PENDIENTE" && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirmar({ ids: [s.id], aprobar: false, titulo: "¿Rechazar el adicional?" })}>
                  Rechazar
                </Button>
                <Button onClick={() => setConfirmar({ ids: [s.id], aprobar: true, titulo: `¿Aprobar el adicional de ${s.obra}?` })}>Aprobar</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Confirm
        open={!!confirmar}
        title={confirmar?.titulo ?? ""}
        pending={pending}
        danger={confirmar?.aprobar === false}
        disabled={confirmar?.aprobar === false && !motivo.trim()}
        onNo={() => {
          setConfirmar(null);
          setMotivo("");
        }}
        onYes={resolver}
      >
        {confirmar?.aprobar === false ? (
          <Field label="Motivo del rechazo">
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={cn(inputClass, "h-auto py-3")} />
          </Field>
        ) : (
          confirmar && (
            <p className="num text-[19px] font-semibold">
              {soles(solicitudes.filter((s) => confirmar.ids.includes(s.id)).reduce((a, s) => a + s.total, 0))}
            </p>
          )
        )}
      </Confirm>
    </div>
  );
}

function Estado({ s, conEstado }: { s: Solicitud; conEstado: boolean }) {
  if (s.estado === "APROBADA") return <MarcaAdicional requerimiento={s.requerimiento} />;
  if (!conEstado) return null;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full px-2 text-[13px] font-semibold leading-5",
        s.estado === "PENDIENTE" ? "bg-sunken text-ink-2" : "bg-danger-bg text-danger",
      )}
    >
      {s.estado === "PENDIENTE" ? "Por aprobar" : "Rechazada"}
    </span>
  );
}

/** Logística: «Pedir adicional», con la obra, sus partidas y el motivo. */
export function PedirAdicional({
  obras,
  items,
  etapas,
}: {
  obras: { id: number; nombre: string; empresa: string }[];
  items: { id: number; descripcion: string; unidad: string }[];
  etapas: string[];
}) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [obra, setObra] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const cerrar = () => {
    setAbierta(false);
    setObra(null);
    setMotivo("");
  };
  return (
    <>
      <Button onClick={() => setAbierta(true)}>
        <Plus size={18} /> Pedir adicional
      </Button>
      {abierta && (
        <HojaAdicional
          titulo="Pedir adicional"
          boton="Enviar a Gerencia"
          partidas={[]}
          items={items}
          etapas={etapas}
          faltanExtra={[!obra && "obra", !motivo.trim() && "motivo"]}
          cabecera={
            <>
              <Field label="Obra">
                <SearchSelect
                  label="Obra"
                  value={obra}
                  onChange={setObra}
                  options={obras.map((o) => ({ value: String(o.id), label: o.nombre, hint: o.empresa }))}
                  placeholder="Elegir obra"
                />
              </Field>
              <Field label="Motivo">
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={cn(inputClass, "h-auto py-3")} />
              </Field>
            </>
          }
          onClose={cerrar}
          onGuardar={async (lineas) => {
            const r = await pedirAdicional({ obraId: Number(obra), partidas: lineas, motivo });
            if (!r.ok) return r.error;
            cerrar();
            router.refresh();
            return null;
          }}
        />
      )}
    </>
  );
}
