"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Faltan } from "@/components/ui/faltan";
import { Sheet } from "@/components/ui/sheet";
import { hoyISO } from "@/lib/format";
import { crearOrdenPago } from "../actions";

type Cuenta = { codigo: string; denominacion: string };

export function NuevaOrdenPago({
  obras,
  proveedores,
  cuentas,
}: {
  obras: { id: number; nombre: string }[];
  proveedores: { id: number; ruc_o_cod: string; razon_social: string }[];
  cuentas: Cuenta[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        aria-label="Nueva orden de pago"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Nueva OP
      </Button>
      {open && <NuevaOpSheet obras={obras} proveedores={proveedores} cuentas={cuentas} onClose={() => setOpen(false)} />}
    </>
  );
}

function NuevaOpSheet({
  obras,
  proveedores,
  cuentas,
  onClose,
}: {
  obras: { id: number; nombre: string }[];
  proveedores: { id: number; ruc_o_cod: string; razon_social: string }[];
  cuentas: Cuenta[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [obra, setObra] = useState<string | null>(obras.length === 1 ? String(obras[0].id) : null);
  const [proveedor, setProveedor] = useState<string | null>(null);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [cuenta, setCuenta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const res = await crearOrdenPago({
        obraId: Number(obra),
        proveedorId: Number(proveedor),
        concepto,
        monto: Number(monto),
        fecha,
        cuenta,
      });
      if (!res.ok) return setError(res.error);
      router.push(`/contabilidad/op/${res.data}`);
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Nueva orden de pago"
      full
      footer={
        <div className="flex flex-col gap-2">
          <Faltan items={[!obra && "obra", !proveedor && "beneficiario", !concepto.trim() && "concepto", !(Number(monto) > 0) && "monto"]} />
          <Button size="lg" onClick={guardar} disabled={pending || !obra || !proveedor || !concepto.trim() || !(Number(monto) > 0)}>
            Crear OP
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Obra">
          <SearchSelect
            label="Obra"
            value={obra}
            onChange={setObra}
            options={obras.map((o) => ({ value: String(o.id), label: o.nombre }))}
          />
        </Field>
        <Field label="Beneficiario">
          <SearchSelect
            label="Beneficiario"
            value={proveedor}
            onChange={setProveedor}
            options={proveedores.map((p) => ({ value: String(p.id), label: p.razon_social, hint: p.ruc_o_cod }))}
          />
        </Field>
        <Field label="Concepto">
          <textarea
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            rows={2}
            className="w-full rounded-field border border-line bg-surface px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto">
            <NumberInput value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
          <Field label="Fecha">
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>
        <Field label="Cuenta">
          <SearchSelect
            label="Cuenta"
            value={cuenta}
            onChange={setCuenta}
            options={cuentas.map((c) => ({ value: c.codigo, label: `${c.codigo} ${c.denominacion}` }))}
          />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
