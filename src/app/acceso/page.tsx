"use client";

import { useActionState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { entrarDemo } from "./actions";

export default function AccesoPage() {
  const [error, action, pending] = useActionState(entrarDemo, null);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <form action={action} className="flex flex-col gap-4">
        <Field label="Contraseña de acceso">
          <Input name="clave" type="password" autoComplete="current-password" autoFocus required />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" disabled={pending}>
          Entrar
        </Button>
      </form>
    </main>
  );
}
