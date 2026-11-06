"use client";

import { FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, hoyISO } from "@/lib/format";
import { subirArchivos } from "@/components/documentos";
import { marcarGuiaAnulada, registrarGuia, setRequiereGuia } from "../../../actions";
import { EnlaceArchivo } from "@/components/visor";
import { FichaTransportista, TRANSPORTISTA_VACIO, type Transportista } from "../../../transportistas/transportistas-list";

export type ModalidadTransporte = "PROVEEDOR" | "PROPIO" | "TERCERO";
export const MODALIDAD: Record<ModalidadTransporte, string> = {
  PROVEEDOR: "El proveedor con su unidad",
  PROPIO: "Nuestro transporte",
  TERCERO: "Transportista contratado por el proveedor",
};
// En obra lo habitual es que el proveedor entregue con su propia unidad (transporte privado del remitente).
const MODALIDAD_COMUN: ModalidadTransporte = "PROVEEDOR";

export type GuiaOrden = {
  id: number;
  estado: "SOLICITADA" | "EMITIDA" | "ANULACION_PENDIENTE" | "ANULADA";
  modalidad: ModalidadTransporte;
  punto_partida: string;
  punto_llegada: string;
  transportista_id: number | null;
  placa: string;
  licencia: string;
  detalle: string;
  fecha_traslado: string;
  numero_guia: string | null;
  url: string | null;
};

const ESTADO = {
  SOLICITADA: "Sin registrar",
  EMITIDA: "Emitida",
  ANULACION_PENDIENTE: "Por anular en SUNAT",
  ANULADA: "Anulada",
} as const;

/** Guía de remisión de una OC: si la requiere, Logística la registra (prod 1, sin Contabilidad). */
export function GuiaRemision({
  obraId,
  numero,
  estadoOrden,
  requiere,
  guia,
  transportistas,
  detalleSugerido,
}: {
  obraId: number;
  numero: string;
  estadoOrden: string;
  requiere: boolean;
  guia: GuiaOrden | null;
  transportistas: Transportista[];
  detalleSugerido: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const vigente = guia && guia.estado !== "ANULADA" ? guia : null;
  const emitida = vigente?.estado === "EMITIDA" || vigente?.estado === "ANULACION_PENDIENTE";
  // Se pide con la orden cotizada; antes solo se marca si la lleva.
  const puedePedir = requiere && !emitida && estadoOrden !== "EMITIDA" && estadoOrden !== "ANULADA";
  // Se decide hasta facturar; después queda fijo (también en la base).
  const editable = (estadoOrden === "EMITIDA" || estadoOrden === "PRECIOS_CONFIRMADOS") && !emitida;

  const anulada = () =>
    startTransition(async () => {
      setError(null);
      const r = await marcarGuiaAnulada(obraId, numero, guia!.id);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  const cambiar = (v: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await setRequiereGuia(obraId, numero, v);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <section id="guia" className="flex scroll-mt-20 flex-col gap-2 rounded-panel bg-surface p-3">
      <label className={cn("flex min-h-11 items-center justify-between gap-3 px-1", editable && "cursor-pointer")}>
        <span className="rotulo text-[17px] font-semibold">Guía de remisión</span>
        <input
          type="checkbox"
          aria-label="Requiere guía de remisión"
          checked={requiere}
          disabled={pending || !editable}
          onChange={(e) => cambiar(e.target.checked)}
          className="h-6 w-6 shrink-0 accent-primary"
        />
      </label>
      {guia && (
        <div className="flex flex-col gap-1 px-1 text-[15px]">
          <p
            className={cn(
              "font-semibold",
              guia.estado === "ANULACION_PENDIENTE" || guia.estado === "ANULADA" ? "text-danger" : guia.estado === "EMITIDA" ? "text-ok" : "text-ink-2",
            )}
          >
            {ESTADO[guia.estado]}
            {guia.numero_guia && <span className="num"> {guia.numero_guia}</span>}
          </p>
          <p className="text-ink-2">{MODALIDAD[guia.modalidad]}</p>
          <p className="num text-ink-2">Traslado {fecha(guia.fecha_traslado)}, placa {guia.placa}</p>
          {guia.url && (
            <EnlaceArchivo href={guia.url} nombre={`Guía ${guia.numero_guia ?? ""}`.trim()} className="flex min-h-11 items-center gap-2 text-primary">
              <FileText size={18} /> Ver guía
            </EnlaceArchivo>
          )}
        </div>
      )}
      {puedePedir && (
        <Button variant="secondary" onClick={() => setForm(true)} disabled={pending}>
          Registrar guía
        </Button>
      )}
      {guia?.estado === "ANULACION_PENDIENTE" && (
        <Button variant="secondary" onClick={anulada} disabled={pending}>
          Ya se anuló en SUNAT
        </Button>
      )}
      {error && <p role="alert" className="px-1 text-danger">{error}</p>}
      {form && (
        <FormGuia
          obraId={obraId}
          numero={numero}
          guia={vigente}
          transportistas={transportistas}
          detalleSugerido={detalleSugerido}
          onClose={() => setForm(false)}
        />
      )}
    </section>
  );
}

function FormGuia({
  obraId,
  numero,
  guia,
  transportistas,
  detalleSugerido,
  onClose,
}: {
  obraId: number;
  numero: string;
  guia: GuiaOrden | null;
  transportistas: Transportista[];
  detalleSugerido: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modalidad, setModalidad] = useState<ModalidadTransporte>(guia?.modalidad ?? MODALIDAD_COMUN);
  const [transportista, setTransportista] = useState<string | null>(guia?.transportista_id ? String(guia.transportista_id) : null);
  const [partida, setPartida] = useState(guia?.punto_partida ?? "");
  const [llegada, setLlegada] = useState(guia?.punto_llegada ?? "");
  const [placa, setPlaca] = useState(guia?.placa ?? "");
  const [licencia, setLicencia] = useState(guia?.licencia ?? "");
  const [detalle, setDetalle] = useState(guia?.detalle ?? detalleSugerido);
  const [fechaTraslado, setFechaTraslado] = useState(guia?.fecha_traslado ?? hoyISO());
  const [numeroGuia, setNumeroGuia] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);

  // Transportistas creados aquí mismo (aún no llegan en la lista del servidor).
  const [creados, setCreados] = useState<Transportista[]>([]);
  const [nuevoT, setNuevoT] = useState<string | null>(null);
  const todos = [...transportistas, ...creados.filter((c) => !transportistas.some((t) => t.id === c.id))];
  const elegirTransportista = (v: string, lista = todos) => {
    setTransportista(v);
    const t = lista.find((x) => String(x.id) === v);
    if (t?.placa) setPlaca(t.placa);
    if (t?.licencia) setLicencia(t.licencia);
  };

  const enviar = () =>
    startTransition(async () => {
      setError(null);
      let path: string;
      try {
        [{ path }] = await subirArchivos(`guias/${obraId}/${numero}`, [archivo!]);
      } catch (e) {
        return setError(e instanceof Error ? e.message : "No se pudo subir la guía");
      }
      const r = await registrarGuia({
        obraId,
        numero,
        modalidad,
        transportista_id: modalidad === "TERCERO" ? Number(transportista) : null,
        punto_partida: partida,
        punto_llegada: llegada,
        placa,
        licencia,
        detalle,
        fecha_traslado: fechaTraslado,
      }, numeroGuia, path);
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Registrar guía"
      footer={
        <Button size="lg" onClick={enviar} disabled={pending || (modalidad === "TERCERO" && !transportista) || !numeroGuia.trim() || !archivo}>
          Registrar guía
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="N° de guía">
          <Input value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="T001-123" className="num" />
        </Field>
        <Field label="Guía (PDF o foto)">
          <label className={cn(inputClass, "flex cursor-pointer items-center gap-3 active:bg-sunken")}>
            <Upload size={20} className="shrink-0 text-ink-2" aria-hidden />
            <span className={cn("truncate", !archivo && "text-ink-3")}>{archivo?.name ?? "Elegir archivo"}</span>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              aria-label="Guía (PDF o foto)"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
        </Field>
        <Field label="Quién transporta">
          <SearchSelect
            label="Quién transporta"
            value={modalidad}
            onChange={(v) => {
              const m = v as ModalidadTransporte;
              setModalidad(m);
              const t = m === "TERCERO" ? transportistas.find((x) => String(x.id) === transportista) : null;
              setPlaca(t?.placa ?? "");
              setLicencia(t?.licencia ?? "");
            }}
            options={(Object.keys(MODALIDAD) as ModalidadTransporte[]).map((m) => ({ value: m, label: MODALIDAD[m] }))}
          />
        </Field>
        {modalidad === "TERCERO" && (
          <Field label="Transportista">
            <SearchSelect
              label="Transportista"
              value={transportista}
              onChange={(v) => elegirTransportista(v)}
              options={todos.map((t) => ({ value: String(t.id), label: t.razon_social, hint: t.ruc }))}
              crear={{ label: "Nuevo transportista", onCrear: setNuevoT }}
            />
          </Field>
        )}
        {nuevoT != null && (
          <FichaTransportista
            t={{
              ...TRANSPORTISTA_VACIO,
              ruc: /^\d+$/.test(nuevoT) ? nuevoT : "",
              razon_social: /^\d+$/.test(nuevoT) ? "" : nuevoT.toUpperCase(),
            }}
            onGuardado={(t) => {
              setCreados((c) => [...c, t]);
              elegirTransportista(String(t.id), [...todos, t]);
            }}
            onClose={() => setNuevoT(null)}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placa">
            <Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} autoCapitalize="characters" className="num" />
          </Field>
          <Field label="N° licencia">
            <Input value={licencia} onChange={(e) => setLicencia(e.target.value.toUpperCase())} autoCapitalize="characters" className="num" />
          </Field>
        </div>
        <Field label="Punto de partida">
          <Input value={partida} onChange={(e) => setPartida(e.target.value)} />
        </Field>
        <Field label="Punto de llegada">
          <Input value={llegada} onChange={(e) => setLlegada(e.target.value)} />
        </Field>
        <Field label="Inicio del traslado">
          <Input type="date" value={fechaTraslado} onChange={(e) => setFechaTraslado(e.target.value)} />
        </Field>
        <Field label="Ítems y cantidades">
          <textarea value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={6} className={cn(inputClass, "num h-auto py-3 text-[15px]")} />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
