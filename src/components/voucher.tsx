"use client";

import { FileText } from "lucide-react";
import { ImagenFirmada } from "./imagen-firmada";
import { EnlaceArchivo, useVisor } from "./visor";

const ES_IMAGEN = /\.(jpe?g|png|webp|gif|heic)(\?|$)/i;

type Archivo = { url: string; nombre: string; mime: string | null };

/**
 * Documento mostrado directamente. Imagen: en línea (toca para ampliar en el visor). PDF: enlace.
 * Sin archivo: la imagen simulada (`simulado`), que lleva un sello "no válido"; si es un dato histórico
 * (del Excel), solo lo dice: los históricos pueden no tener archivo.
 */
export function VistaArchivo({
  archivo,
  simulado,
  alt,
  historico = false,
}: {
  archivo?: Archivo | null;
  simulado: string;
  alt: string;
  historico?: boolean;
}) {
  const visor = useVisor();
  if (!archivo && historico) {
    return (
      <p className="flex min-h-12 items-center rounded-field border border-dashed border-line px-3 text-[15px] text-ink-3">
        Histórico · sin archivo
      </p>
    );
  }
  const href = archivo?.url ?? simulado;
  const imagen = !archivo || archivo.mime?.startsWith("image/") || ES_IMAGEN.test(archivo.nombre);
  if (imagen) {
    return (
      <>
        <button type="button" onClick={() => visor.abrir([{ url: href, alt }])} aria-label={`Ampliar ${alt}`} className="block w-full">
          <ImagenFirmada src={href} alt={alt} className="w-full rounded-field border border-line" />
        </button>
        {visor.elemento}
      </>
    );
  }
  return (
    <EnlaceArchivo
      href={href}
      nombre={archivo!.nombre}
      className="flex min-h-12 items-center gap-2 rounded-field border border-line px-3 text-primary active:bg-ink/8"
    >
      <FileText size={18} className="shrink-0" />
      <span className="truncate">{archivo!.nombre}</span>
    </EnlaceArchivo>
  );
}

/** Voucher de un pago; sin archivo, voucher simulado no válido (o «Histórico · sin archivo»). */
export function Voucher({ pagoId, archivo, historico }: { pagoId: number; archivo?: Archivo | null; historico?: boolean }) {
  return (
    <VistaArchivo
      historico={historico}
      archivo={archivo}
      simulado={`/voucher-simulado/${pagoId}`}
      alt={archivo ? `Voucher ${archivo.nombre}` : "Voucher simulado, no válido"}
    />
  );
}

/** Comprobante (factura, RxH…); sin archivo, comprobante simulado no válido. */
export function ComprobanteArchivo({
  comprobanteId,
  archivo,
  etiqueta,
  historico,
}: {
  comprobanteId: number;
  archivo?: Archivo | null;
  etiqueta: string;
  historico?: boolean;
}) {
  return (
    <VistaArchivo
      historico={historico}
      archivo={archivo}
      simulado={`/comprobante-simulado/${comprobanteId}`}
      alt={archivo ? etiqueta : `${etiqueta}, simulado no válido`}
    />
  );
}
