import { fecha } from "@/lib/format";

/** Qué pidió corregir Tesorería (y hasta dónde volvió la orden). */
export type Correccion = "DATOS" | "FACTURA" | "PRECIOS";
export const CORRECCION_LABEL: Record<Correccion, string> = {
  DATOS: "Datos o documentos",
  FACTURA: "La factura",
  PRECIOS: "Los precios",
};
/** Lo que le toca a Logística según lo que hay que corregir. */
export const CORRECCION_TAREA: Record<Correccion, string> = {
  DATOS: "corrige y reenvíala",
  FACTURA: "registra la factura nueva",
  PRECIOS: "revisa los precios",
};

export type RechazoVer = {
  id: number;
  motivo: string | null;
  fecha: string;
  anuladas: string[];
  correccion: Correccion | null;
  /** Quién rechazó. */
  por: string | null;
  /** Cuándo volvió a Tesorería, quién la reenvió y qué se corrigió (null: aún por corregir). */
  reenviado: { fecha: string; por: string | null; nota: string | null } | null;
};

const hora = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
const cuando = (iso: string) => `${fecha(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Lima" }))} ${hora.format(new Date(iso))}`;

/** Rechazos de Tesorería de una orden, del más reciente al más antiguo: el rechazo y su reenvío. */
export function HistorialRechazos({ rechazos }: { rechazos: RechazoVer[] }) {
  return (
    <ol className="overflow-hidden rounded-field border border-line">
      {rechazos.map((r, i) => (
        <li key={r.id} className="flex flex-col gap-1 border-b border-line px-3 py-2.5 last:border-0">
          <span className="num flex justify-between gap-3 text-[14px] text-ink-3">
            <span>
              {cuando(r.fecha)}
              {r.por && ` · ${r.por}`}
            </span>
            <span className="shrink-0">{rechazos.length - i}.° rechazo</span>
          </span>
          {r.correccion && <span className="text-[14px] font-semibold text-danger">Corregir: {CORRECCION_LABEL[r.correccion]}</span>}
          <span>{r.motivo ?? "Sin motivo"}</span>
          {r.anuladas.length > 0 && <span className="text-[14px] text-ink-2">Anulada: {r.anuladas.join(", ")}</span>}
          {r.reenviado ? (
            <span className="mt-0.5 rounded-field bg-ok-bg px-2.5 py-1.5 text-[14px] text-ok">
              Reenviada el {cuando(r.reenviado.fecha)}
              {r.reenviado.por && ` · ${r.reenviado.por}`}
              {r.reenviado.nota && <span className="block text-ink">{r.reenviado.nota}</span>}
            </span>
          ) : (
            <span className="text-[14px] font-semibold text-warn">Por corregir</span>
          )}
        </li>
      ))}
    </ol>
  );
}
