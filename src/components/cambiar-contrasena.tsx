"use client";

import { useState, useTransition } from "react";
import { cambiarMiContrasena } from "@/app/login/actions";
import { MIN_CONTRASENA } from "@/lib/usuarios";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { PasswordInput } from "./ui/password-input";
import { Sheet } from "./ui/sheet";
import { Faltan } from "./ui/faltan";

/** Cambiar la propia contraseña (desde el menú del usuario). */
export function CambiarContrasena({ onClose }: { onClose: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const distintas = repetida !== "" && repetida !== nueva;

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const e = await cambiarMiContrasena(actual, nueva);
      if (e) return setError(e);
      setListo(true);
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={listo ? "Contraseña cambiada" : "Cambiar contraseña"}
      footer={
        listo ? (
          <Button size="lg" onClick={onClose}>
            Listo
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Faltan
              items={[
                !actual && "contraseña actual",
                nueva.length < MIN_CONTRASENA && `nueva de ${MIN_CONTRASENA} caracteres`,
                nueva !== repetida && "repetir la nueva",
              ]}
            />
            <Button size="lg" onClick={guardar} disabled={pending || !actual || nueva.length < MIN_CONTRASENA || nueva !== repetida}>
              Cambiar contraseña
            </Button>
          </div>
        )
      }
    >
      {!listo && (
        <div className="flex flex-col gap-4 p-4">
          <Field label="Contraseña actual">
            <PasswordInput value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={`Nueva contraseña (mín. ${MIN_CONTRASENA}, con letras y números)`}>
            <PasswordInput value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Repetir la contraseña">
            <PasswordInput value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" aria-invalid={distintas} />
          </Field>
          {distintas && <p className="text-danger">No coinciden</p>}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
