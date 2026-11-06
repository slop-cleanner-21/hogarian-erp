"use client";

import { Check, FileText, History, Paperclip, Pencil } from "lucide-react";
import { SERIE_INVALIDA, serieValida } from "@/lib/serie";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, money, soles } from "@/lib/format";
import { retencion4ta, suspensionVigente } from "@/lib/retencion";
import { createClient } from "@/lib/supabase/client";
import { TIPO_COMPROBANTE_LABEL, type TipoComprobante } from "@/lib/types";
import { editarComprobante } from "../../../actions";
import { EnlaceArchivo } from "@/components/visor";
import { Faltan } from "@/components/ui/faltan";

type Datos = { tipo: TipoComprobante; serie: string; numero: string; fecha_emision: string; total: number; retencion: number; archivo_path: string | null };

export type ComprobanteOrden = Datos & {
  id: number;
  /** URL firmada del archivo (imagen o PDF). */
  url: string | null;
  /** Ya contabilizado o con pagos: no se puede corregir. */
  bloqueado: boolean;
  historial: { id: number; anterior: Datos; nuevo: Datos; motivo: string | null; editadoAt: string; quien: string }[];
};

const resumen = (d: Datos) => `${TIPO_COMPROBANTE_LABEL[d.tipo]} ${d.serie}-${d.numero}, ${fecha(d.fecha_emision)}, ${money(d.total)}`;

/** Comprobantes de la orden: Logística los corrige (p. ej. tras un rechazo) y cada cambio queda en el historial. */
export function ComprobantesOrden({
  comprobantes,
  obraId,
  numero,
  empresaId,
  proveedorRuc,
  esOS,
  retencionProveedor,
}: {
  comprobantes: ComprobanteOrden[];
  obraId: number;
  numero: string;
  empresaId: number;
  proveedorRuc: string;
  /** Una OS solo lleva factura o recibo por honorarios. */
  esOS: boolean;
  /** % de retención de 4ta del proveedor y fecha de su suspensión (si tiene). */
  retencionProveedor: { pct: number; suspension: string | null };
}) {
  const [editando, setEditando] = useState<ComprobanteOrden | null>(null);
  const [historial, setHistorial] = useState<number | null>(null);
  if (!comprobantes.length) return null;
  return (
    <section aria-label="Comprobantes" className="overflow-hidden rounded-panel bg-surface">
      {comprobantes.map((c) => (
        <div key={c.id} className="border-b border-line px-4 py-3 last:border-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {c.url ? (
                <EnlaceArchivo
                  href={c.url}
                  nombre={`${TIPO_COMPROBANTE_LABEL[c.tipo]} ${c.serie}-${c.numero}`}
                  className="flex min-h-11 items-center gap-2 font-semibold text-primary"
                >
                  <FileText size={18} className="shrink-0" />
                  {TIPO_COMPROBANTE_LABEL[c.tipo]} {c.serie}-{c.numero}
                </EnlaceArchivo>
              ) : (
                <div className="font-semibold">
                  {TIPO_COMPROBANTE_LABEL[c.tipo]} {c.serie}-{c.numero}
                </div>
              )}
              <div className="num flex gap-3 text-sm text-ink-2">
                <span>{fecha(c.fecha_emision)}</span>
                <span>{money(c.total)}</span>
              </div>
            </div>
            <div className="flex shrink-0">
              {c.historial.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHistorial(historial === c.id ? null : c.id)}
                  aria-expanded={historial === c.id}
                  aria-label={`Historial de cambios (${c.historial.length})`}
                  className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-control px-2 text-[14px] text-ink-2 active:bg-ink/8"
                >
                  <History size={17} /> {c.historial.length}
                </button>
              )}
              {!c.bloqueado && (
                <button
                  type="button"
                  onClick={() => setEditando(c)}
                  aria-label="Corregir comprobante"
                  className="flex h-11 w-11 items-center justify-center rounded-control text-primary active:bg-ink/8"
                >
                  <Pencil size={18} />
                </button>
              )}
            </div>
          </div>
          {historial === c.id && (
            <ul className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-[14px]">
              {c.historial.map((h) => (
                <li key={h.id}>
                  <div className="num flex gap-3 text-ink-3">
                    <span>{fecha(h.editadoAt)}</span>
                    <span>{h.quien}</span>
                  </div>
                  <div className="text-ink-2 line-through">{resumen(h.anterior)}</div>
                  <div>{resumen(h.nuevo)}</div>
                  {h.motivo && <div className="text-ink-2">{h.motivo}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {editando && (
        <EditarComprobante
          c={editando}
          obraId={obraId}
          numero={numero}
          carpeta={`${empresaId}/${proveedorRuc}`}
          esOS={esOS}
          retencionProveedor={retencionProveedor}
          onClose={() => setEditando(null)}
        />
      )}
    </section>
  );
}

function EditarComprobante({
  c,
  obraId,
  numero,
  carpeta,
  esOS,
  retencionProveedor,
  onClose,
}: {
  c: ComprobanteOrden;
  obraId: number;
  numero: string;
  carpeta: string;
  esOS: boolean;
  retencionProveedor: { pct: number; suspension: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoComprobante>(c.tipo);
  const [serie, setSerie] = useState(c.serie);
  const [num, setNum] = useState(c.numero);
  const [fechaEmision, setFechaEmision] = useState(c.fecha_emision);
  const [total, setTotal] = useState(String(c.total));
  const [archivo, setArchivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // Retención de 4ta (la exige la base): sin cambiar tipo, fecha ni total, la que tenía; si no, la que corresponde.
  const totalNum = Number(total) || 0;
  const sinCambio = tipo === c.tipo && fechaEmision === c.fecha_emision && Math.round(totalNum * 100) === Math.round(c.total * 100);
  const retencion = sinCambio ? c.retencion : tipo === "RXH" ? retencion4ta(totalNum, fechaEmision, retencionProveedor) : 0;
  const suspendida = tipo === "RXH" && suspensionVigente(retencionProveedor.suspension, fechaEmision);
  const tipos = Object.entries(TIPO_COMPROBANTE_LABEL)
    .filter(([value]) => !esOS || value === "FACTURA" || value === "RXH" || value === c.tipo)
    .map(([value, label]) => ({ value, label }));
  // Un error del servidor deja de valer en cuanto se corrige un dato.
  const con =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setError(null);
      set(v);
    };

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      if (!serieValida(tipo, serie)) return setError(SERIE_INVALIDA);
      const supabase = createClient();
      let archivoPath: string | null = null;
      if (archivo) {
        const ext = archivo.name.split(".").pop()?.toLowerCase() ?? "pdf";
        archivoPath = `${carpeta}/${serie}-${num}-${Date.now()}.${ext}`;
        const { error: up } = await supabase.storage.from("comprobantes").upload(archivoPath, archivo);
        if (up) return setError(up.message);
      }
      const r = await editarComprobante({
        id: c.id,
        obraId,
        numero,
        tipo,
        serie,
        numeroComprobante: num,
        fecha: fechaEmision,
        total: Number(total),
        retencion,
        archivoPath,
        motivo,
      });
      if (!r.ok) {
        if (archivoPath) await supabase.storage.from("comprobantes").remove([archivoPath]);
        return setError(r.error);
      }
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Corregir comprobante"
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-danger">{error}</p>}
          <Faltan items={[!serie.trim() && "serie", !num.trim() && "número", !(Number(total) > 0) && "total"]} />
          <Button size="lg" onClick={guardar} disabled={pending || !serie.trim() || !num.trim() || !(Number(total) > 0)}>
            Guardar corrección
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Tipo">
          <SearchSelect
            label="Tipo"
            value={tipo}
            onChange={(v) => con(setTipo)(v as TipoComprobante)}
            options={tipos}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serie">
            <Input value={serie} onChange={(e) => con(setSerie)(e.target.value.toUpperCase())} maxLength={10} className="num" />
          </Field>
          <Field label="Número">
            <Input value={num} onChange={(e) => con(setNum)(e.target.value)} maxLength={20} inputMode="numeric" className="num" />
          </Field>
        </div>
        <Field label="Fecha de emisión">
          <Input type="date" value={fechaEmision} onChange={(e) => con(setFechaEmision)(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total">
            <NumberInput value={total} onChange={(e) => con(setTotal)(e.target.value)} />
          </Field>
          {(tipo === "RXH" || retencion > 0) && (
            <Field
              label={
                sinCambio
                  ? "Retención 4ta"
                  : suspendida
                    ? `Retención 4ta · suspendida ${retencionProveedor.suspension!.slice(0, 4)}`
                    : `Retención 4ta (${retencionProveedor.pct} %)`
              }
            >
              <Input value={soles(retencion)} readOnly tabIndex={-1} className="num bg-ink/5 text-right text-ink-2" />
            </Field>
          )}
        </div>
        <input ref={fileRef} type="file" hidden accept="application/pdf,image/*,text/xml" onChange={(e) => con(setArchivo)(e.target.files?.[0] ?? null)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(inputClass, "flex items-center gap-2 text-left", archivo ? "text-ink" : "text-ink-3")}
        >
          {archivo ? <Check size={18} className="shrink-0 text-ok" /> : <Paperclip size={18} className="shrink-0" />}
          <span className="truncate">{archivo ? archivo.name : c.archivo_path ? "Reemplazar archivo" : "Subir archivo"}</span>
        </button>
        <Field label="Motivo de la corrección">
          <textarea value={motivo} onChange={(e) => con(setMotivo)(e.target.value)} rows={2} className={cn(inputClass, "h-auto py-3")} />
        </Field>
      </div>
    </Sheet>
  );
}
