"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { EntrarConHuella, entroConContrasena } from "@/components/huella";
import { Logo } from "@/components/logo";
import { TemaBoton } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { login, type EstadoLogin } from "./actions";

// Usuarios semilla del entorno local (supabase/seed/usuarios_locales.sql). La variable se fija al compilar: en
// producción la lista y la contraseña de prueba ni siquiera llegan al navegador.
const LOCAL = process.env.NEXT_PUBLIC_USUARIOS_LOCALES === "1";
const USUARIOS_LOCALES = LOCAL
  ? ([
      ["Logística", "logistica@erp.local"],
      ["Tesorería", "tesoreria@erp.local"],
      ["Gerencia", "gerencia@erp.local"],
      ["Jefe de Operaciones", "jefeoperaciones@erp.local"],
      ["Admin", "admin@erp.local"],
    ] as const)
  : [];
const CLAVE_LOCAL = LOCAL ? "erp12345" : "";

/** Cuánto falta, en minutos o segundos. */
const falta = (s: number) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`);

/** El ingreso. Tras demasiados intentos fallidos, espera (con la cuenta regresiva en el botón). */
export function FormularioLogin() {
  const [estado, action, pending] = useActionState<EstadoLogin, FormData>(login, null);
  const form = useRef<HTMLFormElement>(null);
  const [restante, setRestante] = useState(0);

  // Tras cada intento, si hay que esperar, la cuenta regresiva. (Se ajusta al cambiar la respuesta, durante el render:
  // https://react.dev/learn/you-might-not-need-an-effect)
  const [visto, setVisto] = useState<EstadoLogin>(null);
  if (estado !== visto) {
    setVisto(estado);
    if (estado) setRestante(estado.espera);
  }
  useEffect(() => {
    if (restante <= 0) return;
    const t = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [restante]);

  const entrarComo = (email: string) => {
    const f = form.current!;
    (f.elements.namedItem("email") as HTMLInputElement).value = email;
    (f.elements.namedItem("password") as HTMLInputElement).value = CLAVE_LOCAL;
    f.requestSubmit();
  };

  const bloqueado = pending || restante > 0;
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="absolute right-1 top-[max(0.25rem,env(safe-area-inset-top))]">
        <TemaBoton />
      </div>
      <div className="flex flex-col gap-6">
        <Logo />
        <h1 className="rotulo text-[34px] font-semibold leading-none text-ink-2">Ingresar</h1>
      </div>
      <EntrarConHuella disabled={pending} />
      <form
        ref={form}
        action={action}
        onSubmit={(e) => entroConContrasena((e.currentTarget.elements.namedItem("email") as HTMLInputElement).value)}
        className="flex flex-col gap-4"
      >
        <Field label="Correo">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Contraseña">
          <PasswordInput name="password" autoComplete="current-password" required />
        </Field>
        {estado?.error && (
          <p role="alert" className="text-sm text-danger">
            {restante > 0 ? `Demasiados intentos. Vuelve a intentarlo en ${falta(restante)}` : estado.error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={bloqueado}>
          {restante > 0 ? `Ingresar (${falta(restante)})` : "Ingresar"}
        </Button>
      </form>
      {USUARIOS_LOCALES.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {USUARIOS_LOCALES.map(([label, email]) => (
            <Button key={email} variant="secondary" disabled={bloqueado} onClick={() => entrarComo(email)}>
              {label}
            </Button>
          ))}
        </div>
      )}
    </main>
  );
}
