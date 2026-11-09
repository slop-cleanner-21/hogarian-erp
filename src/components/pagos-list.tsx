"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { asignarCuentaOP, contabilizarPago, vouchersPago } from "@/app/contabilidad/actions";
import type { AdjuntoFirmado } from "@/lib/adjuntos";
import { fecha, soles } from "@/lib/format";
import type { PagoFila } from "@/lib/queries";
import { AsientoView } from "./asiento-view";
import { Lista, Pila } from "./lista";
import { Button } from "./ui/button";
import { SearchSelect } from "./ui/search-select";
import { Sheet } from "./ui/sheet";
import { Voucher } from "./voucher";

type Cuenta = { codigo: string; denominacion: string };

export function PagosList({
  pagos,
  contabilidad,
  cuentas = [],
}: {
  pagos: PagoFila[];
  contabilidad?: boolean;
  cuentas?: Cuenta[];
}) {
  const [activo, setActivo] = useState<PagoFila | null>(null);
  return (
    <>
      <Lista encabezado={[<Pila key="i">{["Proveedor", "Operación, banco y fecha"]}</Pila>, "Monto"]}>
        {pagos.map((p) => (
          <li key={p.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => setActivo(p)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink/8"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.proveedores || p.empresa}</div>
                <div className="num flex gap-3 text-sm text-ink-3">
                  <span>Op. {p.numero_operacion}</span>
                  <span>{p.banco ?? "—"}</span>
                  <span>{fecha(p.fecha)}</span>
                </div>
              </div>
              <div className="rotulo shrink-0 text-[19px] font-medium">{soles(p.monto)}</div>
            </button>
          </li>
        ))}
        {pagos.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin pagos</li>}
      </Lista>
      {activo && <PagoSheet pago={activo} contabilidad={contabilidad} cuentas={cuentas} onClose={() => setActivo(null)} />}
    </>
  );
}

function PagoSheet({
  pago,
  contabilidad,
  cuentas,
  onClose,
}: {
  pago: PagoFila;
  contabilidad?: boolean;
  cuentas: Cuenta[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [vouchers, setVouchers] = useState<AdjuntoFirmado[] | null>(null);
  const [cuentasOp, setCuentasOp] = useState<Record<number, string>>({});
  const asignarCuenta = (opId: number, cuenta: string) =>
    startTransition(async () => {
      setCuentasOp((c) => ({ ...c, [opId]: cuenta }));
      const r = await asignarCuentaOP(opId, cuenta);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  useEffect(() => {
    vouchersPago(pago.id).then((r) => (r.ok ? setVouchers(r.data) : setError(r.error)));
  }, [pago.id]);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Op. ${pago.numero_operacion}`}
      footer={
        contabilidad &&
        !pago.asiento_id && (
          <Button
            size="lg"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await contabilizarPago(pago.id);
                if (!r.ok) return setError(r.error);
                onClose();
                router.refresh();
              })
            }
          >
            Contabilizar
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">Empresa</dt>
          <dd>{pago.empresa}</dd>
          <dt className="text-ink-3">Proveedor</dt>
          <dd>{pago.proveedores}</dd>
          <dt className="text-ink-3">Banco</dt>
          <dd>{pago.banco ?? "—"}</dd>
          <dt className="text-ink-3">Fecha</dt>
          <dd>{fecha(pago.fecha)}</dd>
          <dt className="font-semibold">Monto</dt>
          <dd className="font-semibold">{soles(pago.monto)}</dd>
        </dl>
        <ul className="overflow-hidden rounded-panel border border-line">
          {pago.documentos.map((d, i) => (
            <li key={i} className="flex items-baseline gap-3 border-b border-line px-3 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="num font-medium">{d.label}</div>
                {d.detalle && <div className="text-sm text-ink-2">{d.detalle}</div>}
                {contabilidad && d.ordenPagoId && (
                  <div className="mt-2">
                    <SearchSelect
                      label={`Cuenta contable ${d.label}`}
                      placeholder="Asignar cuenta contable"
                      value={cuentasOp[d.ordenPagoId] ?? d.cuenta}
                      disabled={!!pago.asiento_id || pending}
                      onChange={(c) => asignarCuenta(d.ordenPagoId!, c)}
                      options={cuentas.map((c) => ({ value: c.codigo, label: `${c.codigo} ${c.denominacion}` }))}
                    />
                  </div>
                )}
              </div>
              <span className="num shrink-0">{soles(d.monto)}</span>
            </li>
          ))}
        </ul>
        {vouchers && (
          <div className="flex flex-col gap-2">
            {vouchers.length === 0 ? (
              <Voucher pagoId={pago.id} />
            ) : (
              vouchers.map((v) => <Voucher key={v.id} pagoId={pago.id} archivo={v} />)
            )}
          </div>
        )}
        {pago.asiento_id && <AsientoView id={pago.asiento_id} />}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
