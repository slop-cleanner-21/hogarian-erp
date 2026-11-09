import { ButtonLink } from "@/components/ui/button";

// Una pantalla o un registro que no existe (un enlace viejo, una OP borrada): en español y con salida al inicio.
export default function NoEncontrado() {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="rotulo text-[26px] font-semibold leading-tight">No existe</h1>
      <ButtonLink href="/" className="w-full">
        Ir al inicio
      </ButtonLink>
    </main>
  );
}
