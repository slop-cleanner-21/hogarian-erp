"use client";

import { WifiOff } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

// Cualquier pantalla que falle (casi siempre por la señal: "Failed to fetch") muestra esto en vez
// de la página de error genérica, con la opción de reintentar sin perder la sesión.
export default function ErrorPantalla({ error, retry }: { error: unknown; retry: () => void }) {
  const sinRed =
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    (error instanceof Error && /fetch|network|load failed/i.test(error.message));
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {sinRed && <WifiOff size={36} className="text-ink-3" />}
      <h1 className="rotulo text-[26px] font-semibold leading-tight">
        {sinRed ? "Sin conexión" : "No se pudo cargar esta pantalla"}
      </h1>
      <p className="text-ink-2">
        {sinRed ? "Revisa la señal del teléfono e inténtalo de nuevo." : "Inténtalo de nuevo. Si sigue fallando, vuelve al inicio."}
      </p>
      <div className="flex w-full gap-2">
        <ButtonLink href="/" variant="secondary" className="flex-1">
          Ir al inicio
        </ButtonLink>
        <Button className="flex-1" onClick={() => retry()}>
          Reintentar
        </Button>
      </div>
    </main>
  );
}
