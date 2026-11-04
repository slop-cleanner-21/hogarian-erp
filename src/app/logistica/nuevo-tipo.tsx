"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { crearTipoMaterial } from "./actions";

/** Hoja para crear un tipo de material; `onCreado` recibe el código ya guardado. */
export function NuevoTipoSheet({
  inicial,
  titulo = "Nuevo tipo de material",
  onCreado,
  onClose,
}: {
  inicial: string;
  titulo?: string;
  onCreado: (codigo: string) => void;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const guardar = () =>
    startTransition(async () => {
      const r = await crearTipoMaterial(nombre);
      if (!r.ok) return setError(r.error);
      onCreado(r.data);
      onClose();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={titulo}
      footer={
        <Button className="w-full" onClick={guardar} disabled={pending || nombre.trim().length < 3}>
          {pending ? "Guardando…" : "Crear"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <Field label="Nombre">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} data-autofocus />
        </Field>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
