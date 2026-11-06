"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { guardarObra } from "../actions";
import { Faltan } from "@/components/ui/faltan";

/** Gerencia crea una obra; su presupuesto queda en borrador para Operaciones. */
export function NuevaObra({ empresas }: { empresas: { id: number; nombre: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState<string | null>(empresas.length === 1 ? String(empresas[0].id) : null);
  const [direccion, setDireccion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const crear = () =>
    startTransition(async () => {
      setError(null);
      const r = await guardarObra({ id: null, nombre, empresaId: Number(empresa), direccion });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.push(`/gerencia/obras/${r.data}`);
    });

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Nueva obra
      </Button>
      {open && (
        <Sheet
          open
          onClose={() => setOpen(false)}
          title="Nueva obra"
          footer={
            <div className="flex flex-col gap-2">
              <Faltan items={[!nombre.trim() && "nombre", !empresa && "empresa"]} />
              <Button size="lg" onClick={crear} disabled={pending || !nombre.trim() || !empresa}>
                Crear obra
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            <Field label="Nombre">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Empresa">
              <SearchSelect label="Empresa" value={empresa} onChange={setEmpresa} options={empresas.map((e) => ({ value: String(e.id), label: e.nombre }))} />
            </Field>
            <Field label="Dirección">
              <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </Field>
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
