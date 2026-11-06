"use client";

import { Check, Download, Eye, Pencil, Send, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { BotonCopiar, copiarTexto } from "@/components/copiar";
import { IconoWhatsApp } from "@/components/iconos";
import { Button } from "@/components/ui/button";
import { abrirBlob, useEsPwa } from "@/components/visor";
import { cn, fecha, money, telefonoIntl } from "@/lib/format";
import type { VOcItem, VOrden } from "@/lib/types";
import type { DatosContrato } from "@/lib/pdf/contrato-pdf";
import { firmaContrato } from "./contrato-actions";
import { logoPdfEmpresa } from "@/lib/empresas";
import { guardarGlosaRhe, marcarContratoEnviado } from "../../../actions";

export type { DatosContrato };

const BOTON_BLOQUE = "h-16 flex-col gap-1 px-1 text-[15px]";

type Contacto = { telefono: string; whatsapp: boolean; telegram: boolean };

/**
 * Contrato de la OS (100 % del monto): se genera al confirmar precios y Logística sube el firmado (`firmado`, el
 * bloque de documentos); sin él la OS no pasa a Tesorería. Con recibo por honorarios es de locación y lleva el
 * concepto que el proveedor pone en su recibo; con factura es comercial, sin concepto.
 */
export function ContratoOS({
  orden,
  items,
  contactos,
  firmado,
  documentos,
  datos,
}: {
  orden: VOrden;
  items: VOcItem[];
  contactos: Contacto[];
  firmado: boolean;
  documentos: ReactNode;
  datos?: DatosContrato;
}) {
  const router = useRouter();
  const pwa = useEsPwa();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [glosa, setGlosa] = useState(orden.glosa_rhe ?? "");
  // Con el contrato ya firmado, el concepto quedó en el papel: no se cambia.
  const editable = !firmado && (orden.estado === "PRECIOS_CONFIRMADOS" || orden.estado === "FACTURADA");
  const contactoWa = contactos.find((c) => c.whatsapp);
  const contactoTg = contactos.find((c) => c.telegram);
  const comercial = datos?.comprobante === "FACTURA";

  const nombre = `Contrato-OS-${orden.numero}-${orden.obra}.pdf`.replace(/\s+/g, "_");
  const generar = async () => {
    const [{ contratoPdfBlob }, firma] = await Promise.all([import("@/lib/pdf/contrato-pdf"), firmaContrato(orden.obra_id!, orden.numero!)]);
    const logo = logoPdfEmpresa(orden.empresa ?? "");
    const conFirma = {
      ...datos,
      comprobante: datos?.comprobante ?? null,
      fechaInicio: datos?.fechaInicio ?? null,
      representante: datos?.representante ? { ...datos.representante, firma } : (datos?.representante ?? null),
      // Arriba del contrato, el logo de la empresa (react-pdf lo pide por URL completa).
      logo: logo ? new URL(logo, window.location.origin).href : null,
    };
    return contratoPdfBlob({ ...orden, glosa_rhe: glosa }, items, conFirma);
  };
  const descargar = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: nombre }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const texto = () =>
    [
      `${orden.empresa}: contrato de la OS ${orden.numero}, obra ${orden.obra}, por S/ ${money(orden.total)}.`,
      "Por favor fírmalo y envíalo de vuelta.",
      ...(comercial ? [] : ["En tu recibo por honorarios pon este concepto:", glosa]),
    ].join("\n");

  const marcarEnviado = () =>
    startTransition(async () => {
      const r = await marcarContratoEnviado(orden.obra_id!, orden.numero!);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  const compartir = () =>
    startTransition(async () => {
      setError(null);
      const blob = await generar();
      const file = new File([blob], nombre, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: texto(), title: `Contrato OS ${orden.numero}` }).catch(() => {});
      else descargar(blob);
    });

  const whatsapp = () => {
    const destino = contactoWa ? telefonoIntl(contactoWa.telefono) : "";
    window.open(`https://wa.me/${destino}?text=${encodeURIComponent(texto())}`, "_blank");
  };

  const telegram = async () => {
    await copiarTexto(texto());
    setAviso("Mensaje copiado: pégalo en el chat");
    window.open(`https://t.me/+${telefonoIntl(contactoTg!.telefono)}`, "_blank");
  };

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarGlosaRhe(orden.obra_id!, orden.numero!, glosa);
      if (!r.ok) return setError(r.error);
      setEditando(false);
      router.refresh();
    });

  return (
    <section id="contrato" aria-label="Contrato" className="flex flex-col gap-3 rounded-panel bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="rotulo text-[17px] font-semibold">{comercial ? "Contrato comercial" : "Contrato de locación"}</h2>
        <span className={cn("text-right text-[14px]", firmado ? "font-semibold text-ok" : orden.contrato_enviado_at ? "text-ink-2" : "font-semibold text-warn")}>
          {firmado ? "Firmado" : orden.contrato_enviado_at ? `Enviado el ${fecha(orden.contrato_enviado_at)}` : "Sin enviar"}
        </span>
      </div>

      {!comercial && (
      <div className="rounded-field border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-3">Concepto del recibo por honorarios</span>
          <span className="flex">
            {!editando && glosa && <BotonCopiar valor={glosa} label="concepto del recibo" />}
            {editable && !editando && (
              <button
                type="button"
                onClick={() => setEditando(true)}
                aria-label="Editar concepto del recibo"
                className="flex h-11 w-11 items-center justify-center rounded-control text-primary active:bg-ink/8"
              >
                <Pencil size={18} />
              </button>
            )}
          </span>
        </div>
        {editando ? (
          <div className="mt-1 flex flex-col gap-2">
            <textarea
              value={glosa}
              onChange={(e) => setGlosa(e.target.value)}
              rows={4}
              aria-label="Concepto del recibo por honorarios"
              className="w-full rounded-field border border-line bg-surface p-3 text-[16px] leading-snug"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setGlosa(orden.glosa_rhe ?? "");
                  setEditando(false);
                }}
              >
                Cancelar
              </Button>
              <Button className="flex-1" onClick={guardar} disabled={pending || glosa.trim().length < 5}>
                Guardar
              </Button>
            </div>
          </div>
        ) : (
          <p className="leading-snug">{glosa || "—"}</p>
        )}
      </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" onClick={compartir} disabled={pending || editando} className={BOTON_BLOQUE}>
          <Share2 size={20} /> Compartir
        </Button>
        <Button
          variant="secondary"
          disabled={pending || editando}
          className={BOTON_BLOQUE}
          onClick={() => {
            const ventana = pwa ? null : window.open("", "_blank");
            startTransition(async () => abrirBlob(await generar(), nombre, pwa, ventana));
          }}
        >
          <Eye size={20} /> Ver
        </Button>
        <Button variant="secondary" onClick={() => startTransition(async () => descargar(await generar()))} disabled={pending || editando} className={BOTON_BLOQUE}>
          <Download size={20} /> Descargar
        </Button>
      </div>
      {!firmado && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={whatsapp} disabled={pending || editando} className={BOTON_BLOQUE}>
            <IconoWhatsApp size={20} /> WhatsApp
          </Button>
          <Button variant="secondary" onClick={telegram} disabled={pending || editando || !contactoTg} className={BOTON_BLOQUE}>
            <Send size={20} /> Telegram
          </Button>
        </div>
      )}
      {/* Abrir WhatsApp o compartir no prueba que se envió: lo confirma Logística. */}
      {!firmado && !orden.contrato_enviado_at && (
        <Button onClick={marcarEnviado} disabled={pending || editando}>
          <Check size={18} /> Confirmar envío
        </Button>
      )}
      {aviso && <p className="px-1 text-[15px] text-ink-2">{aviso}</p>}
      {error && (
        <p role="alert" className="px-1 text-danger">
          {error}
        </p>
      )}
      <div className="-mx-3 -mb-3 border-t border-line">{documentos}</div>
    </section>
  );
}
