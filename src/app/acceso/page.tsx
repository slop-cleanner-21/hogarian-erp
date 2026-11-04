import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

// Contraseña de la demo: un formulario común que va a /acceso/entrar (una ruta, no una server action).
export default async function AccesoPage({ searchParams }: PageProps<"/acceso">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <form method="post" action="/acceso/entrar" className="flex flex-col gap-4">
        <Field label="Contraseña de acceso">
          <PasswordInput name="clave" autoComplete="current-password" autoFocus required />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            Contraseña incorrecta
          </p>
        )}
        <Button type="submit" size="lg">
          Entrar
        </Button>
      </form>
    </main>
  );
}
