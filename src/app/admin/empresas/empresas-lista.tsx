"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogoEmpresa } from "@/components/logo-empresa";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { guardarEmpresa } from "./actions";
import { Faltan } from "@/components/ui/faltan";

export type EmpresaFicha = {
  id: number;
  nombre: string;
  razonSocial: string | null;
  ruc: string | null;
  direccion: string | null;
  firmanteId: string | null;
};
type Gerente = { id: string; nombre: string; conFirma: boolean; conDni: boolean };

// Sin firmante elegido, firma el gerente con la firma más reciente (el mismo para todas las empresas).
const POR_DEFECTO = "-";

export function EmpresasLista({ empresas, gerentes }: { empresas: EmpresaFicha[]; gerentes: Gerente[] }) {
  const [abierta, setAbierta] = useState<EmpresaFicha | null>(null);
  const gerente = new Map(gerentes.map((g) => [g.id, g]));
  return (
    <>
      <ul className="flex flex-col gap-2">
        {empresas.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setAbierta(e)} className="flex w-full items-center gap-3 rounded-panel bg-surface p-3 text-left active:bg-sunken">
              <LogoEmpresa nombre={e.nombre} className="h-12 w-14" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{e.razonSocial || e.nombre}</span>
                {e.ruc ? (
                  <span className="num text-[14px] text-ink-2">RUC {e.ruc}</span>
                ) : (
                  <span className="text-[14px] font-semibold text-warn">Sin RUC</span>
                )}
                <span className="truncate text-[14px] text-ink-3">
                  Firma: {e.firmanteId ? (gerente.get(e.firmanteId)?.nombre ?? "—") : "el gerente con la firma más reciente"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {abierta && <FichaEmpresa key={abierta.id} e={abierta} gerentes={gerentes} onClose={() => setAbierta(null)} />}
    </>
  );
}

function FichaEmpresa({ e, gerentes, onClose }: { e: EmpresaFicha; gerentes: Gerente[]; onClose: () => void }) {
  const router = useRouter();
  const [razonSocial, setRazonSocial] = useState(e.razonSocial ?? "");
  const [ruc, setRuc] = useState(e.ruc ?? "");
  const [direccion, setDireccion] = useState(e.direccion ?? "");
  const [firmante, setFirmante] = useState<string>(e.firmanteId ?? POR_DEFECTO);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rucValido = ruc === "" || /^(10|15|17|20)\d{9}$/.test(ruc);

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarEmpresa({ id: e.id, razonSocial, ruc, direccion, firmanteId: firmante === POR_DEFECTO ? null : firmante });
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={e.nombre}
      footer={
        <div className="flex flex-col gap-2">
          <Faltan items={[!rucValido && "RUC válido"]} />
          <Button size="lg" onClick={guardar} disabled={pending || !rucValido}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Razón social">
          <Input value={razonSocial} onChange={(ev) => setRazonSocial(ev.target.value.toUpperCase())} placeholder={e.nombre} autoComplete="off" />
        </Field>
        <Field label="RUC">
          <Input
            value={ruc}
            onChange={(ev) => setRuc(ev.target.value.replace(/\D/g, "").slice(0, 11))}
            inputMode="numeric"
            className="num"
            aria-invalid={!rucValido}
            autoComplete="off"
          />
        </Field>
        {!rucValido && <p className="-mt-2 text-danger">11 dígitos, empieza con 10, 15, 17 o 20</p>}
        <Field label="Dirección fiscal">
          <Input value={direccion} onChange={(ev) => setDireccion(ev.target.value)} autoComplete="off" />
        </Field>
        <Field label="Firma los contratos">
          <SearchSelect
            label="Firma los contratos"
            value={firmante}
            onChange={setFirmante}
            multilinea
            options={[
              { value: POR_DEFECTO, label: "El gerente con la firma más reciente" },
              ...gerentes.map((g) => ({
                value: g.id,
                label: g.nombre,
                hint: [g.conFirma ? "con firma" : "sin firma", g.conDni ? "con DNI" : "sin DNI"].join(" · "),
              })),
            ]}
          />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
