"use client";

import { useActionState, useRef } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { login } from "./actions";

// Usuarios semilla del entorno local (supabase/seed/base.sql).
const USUARIOS_LOCALES = [
  ["Logística", "logistica@erp.local"],
  ["Tesorería", "tesoreria@erp.local"],
  ["Gerencia", "gerencia@erp.local"],
  ["Jefe de Operaciones", "jefeoperaciones@erp.local"],
  ["Admin", "admin@erp.local"],
] as const;

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  const form = useRef<HTMLFormElement>(null);

  const entrarComo = (email: string) => {
    const f = form.current!;
    (f.elements.namedItem("email") as HTMLInputElement).value = email;
    (f.elements.namedItem("password") as HTMLInputElement).value = "erp12345";
    f.requestSubmit();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col gap-6">
        <Logo />
        <h1 className="rotulo text-[34px] font-semibold leading-none text-ink-2">Ingresar</h1>
      </div>
      <form ref={form} action={action} className="flex flex-col gap-4">
        <Field label="Correo">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Contraseña">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" disabled={pending}>
          Ingresar
        </Button>
      </form>
      {process.env.NEXT_PUBLIC_USUARIOS_LOCALES === "1" && (
        <div className="grid grid-cols-2 gap-2">
          {USUARIOS_LOCALES.map(([label, email]) => (
            <Button key={email} variant="secondary" disabled={pending} onClick={() => entrarComo(email)}>
              {label}
            </Button>
          ))}
        </div>
      )}
    </main>
  );
}
