"use client";

import { MoreVertical, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Faltan } from "@/components/ui/faltan";
import { ActionBar } from "@/components/action-bar";
import { Lista, Pila } from "@/components/lista";
import { TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha, soles } from "@/lib/format";
import { Voucher } from "@/components/voucher";
import type { AdjuntoFirmado } from "@/lib/adjuntos";
import {
  anularOrdenPago,
  asignarCuentaOP,
  enviarOpATesoreria,
} from "../../actions";

type PagoOP = {
  id: number;
  fecha: string;
  banco: string | null;
  operacion: string | null;
  monto: number;
  contabilizado: boolean;
  vouchers: AdjuntoFirmado[];
};

const ESTADO = {
  BORRADOR: "Borrador",
  EN_TESORERIA: "En Tesorería",
  PAGADA: "Pagada",
  ANULADA: "Anulada",
} as const;

type OP = {
  id: number;
  numero: string;
  estado: keyof typeof ESTADO;
  concepto: string;
  monto: number;
  fecha: string;
  cuenta: string | null;
  motivoAnulacion: string | null;
  obra: string;
  beneficiario: string;
  ruc: string;
  cuentaBancaria: string;
};

export function DetalleOP({
  op,
  conPagos,
  pagos,
  rechazos,
  cuentas,
}: {
  op: OP;
  conPagos: boolean;
  pagos: PagoOP[];
  rechazos: { id: number; motivo: string | null; fecha: string }[];
  cuentas: { codigo: string; denominacion: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enviar, setEnviar] = useState(false);
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState("");
  const editable = op.estado === "BORRADOR";
  const rechazada = editable && rechazos.length > 0;
  // La cuenta se cambia hasta que el asiento del pago la usa.
  const cuentaFija =
    op.estado === "ANULADA" || pagos.some((p) => p.contabilizado);
  const anulable =
    (op.estado === "BORRADOR" || op.estado === "EN_TESORERIA") && !conPagos;

  const correr = (
    accion: () => Promise<{ ok: boolean; error?: string }>,
    despues?: () => void,
  ) =>
    startTransition(async () => {
      setError(null);
      const r = await accion();
      if (!r.ok) return setError(r.error ?? "No se pudo completar");
      despues?.();
      router.refresh();
    });

  return (
    <>
      <TopBar
        title={op.numero}
        back="/contabilidad/op"
        right={
          anulable ? (
            <button
              type="button"
              aria-label="Anular orden de pago"
              onClick={() => setAnular(true)}
              className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
            >
              <MoreVertical size={22} />
            </button>
          ) : null
        }
      />
      <main
        className={cn(
          "mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3",
          editable ? "pb-36" : "pb-10",
        )}
      >
        {editable && rechazos.length > 0 && (
          <section
            role="alert"
            className="rounded-panel bg-danger-bg p-4 text-danger"
          >
            <p className="font-semibold">
              Rechazada por Tesorería el {fecha(rechazos[0].fecha)}
            </p>
            {rechazos[0].motivo && (
              <p className="mt-1 text-ink">{rechazos[0].motivo}</p>
            )}
          </section>
        )}
        <section className="rounded-panel bg-surface p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            {(
              [
                ["Beneficiario", op.beneficiario],
                ["RUC / DNI", op.ruc],
                ["Cuenta", op.cuentaBancaria || "—"],
                ["Obra", op.obra],
                ["Concepto", op.concepto],
                ["Fecha", fecha(op.fecha)],
                [
                  "Estado",
                  rechazada ? "Rechazada, por corregir" : ESTADO[op.estado],
                ],
                ...(op.estado === "ANULADA"
                  ? [["Motivo", op.motivoAnulacion ?? ""]]
                  : []),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd
                  className={cn(
                    "min-w-0 break-words",
                    k === "Estado" &&
                      (op.estado === "ANULADA" || rechazada) &&
                      "text-danger",
                  )}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-semibold">Monto</span>
            <span className="rotulo text-[26px] font-semibold leading-none">
              {soles(op.monto)}
            </span>
          </div>
        </section>

        <section className="rounded-panel bg-surface p-4">
          <Field label="Cuenta contable">
            <SearchSelect
              label="Cuenta contable"
              value={op.cuenta}
              disabled={cuentaFija || pending}
              onChange={(c) => correr(() => asignarCuentaOP(op.id, c))}
              options={cuentas.map((c) => ({
                value: c.codigo,
                label: `${c.codigo} ${c.denominacion}`,
              }))}
            />
          </Field>
        </section>

        {pagos.length > 0 && (
          <section aria-label="Pagos" className="flex flex-col gap-2">
            <Lista
              encabezado={[
                <Pila key="p">{["Pago", "Banco y N° de operación"]}</Pila>,
                "Monto",
              ]}
            >
              {pagos.map((p) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-line px-4 py-3 last:border-0"
                >
                  <span className="num">{fecha(p.fecha)}</span>
                  <span className="num whitespace-nowrap text-right font-medium">
                    {soles(p.monto)}
                  </span>
                  <span className="num text-sm text-ink-3">
                    {[p.banco, p.operacion && `Op. ${p.operacion}`]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <span className="text-right text-sm text-ink-3">
                    {p.contabilizado ? "Contabilizado" : "Por contabilizar"}
                  </span>
                </li>
              ))}
            </Lista>
            {pagos.flatMap((p) =>
              p.vouchers.map((v) => (
                <Voucher key={v.id} pagoId={p.id} archivo={v} />
              )),
            )}
          </section>
        )}

        {/* El último rechazo va arriba, en el aviso; aquí, los anteriores. */}
        {rechazos.length > (rechazada ? 1 : 0) && (
          <Lista
            encabezado={[
              <Pila key="r">{["Rechazos anteriores", "Fecha y motivo"]}</Pila>,
            ]}
          >
            {rechazos.slice(rechazada ? 1 : 0).map((r) => (
              <li
                key={r.id}
                className="border-b border-line px-4 py-3 last:border-0"
              >
                <div className="num text-sm text-ink-3">{fecha(r.fecha)}</div>
                <div>{r.motivo ?? "—"}</div>
              </li>
            ))}
          </Lista>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </main>

      {editable && (
        <ActionBar
          sobreNav
          arriba={<Faltan items={[!op.cuenta && "cuenta contable"]} />}
        >
          <Button
            className="flex-1"
            disabled={pending || !op.cuenta}
            onClick={() => setEnviar(true)}
          >
            <Send size={18} /> Enviar a Tesorería
          </Button>
        </ActionBar>
      )}
      <Confirm
        open={enviar}
        title="¿Enviar a Tesorería?"
        onYes={() =>
          correr(
            () => enviarOpATesoreria(op.id),
            () => setEnviar(false),
          )
        }
        onNo={() => setEnviar(false)}
        pending={pending}
      >
        <p className="rotulo text-[34px] font-semibold leading-none">
          {soles(op.monto)}
        </p>
      </Confirm>
      {anular && (
        <Sheet
          open
          onClose={() => setAnular(false)}
          title={`Anular ${op.numero}`}
          footer={
            <div className="flex flex-col gap-2">
              <Faltan items={[!motivo.trim() && "motivo"]} />
              <Button
                variant="danger"
                size="lg"
                disabled={pending || !motivo.trim()}
                onClick={() =>
                  correr(
                    () => anularOrdenPago(op.id, motivo),
                    () => setAnular(false),
                  )
                }
              >
                Anular
              </Button>
            </div>
          }
        >
          <div className="p-4">
            <Field label="Motivo">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className={cn(inputClass, "h-auto py-3")}
              />
            </Field>
          </div>
        </Sheet>
      )}
    </>
  );
}
