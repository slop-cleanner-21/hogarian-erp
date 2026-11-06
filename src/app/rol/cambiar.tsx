"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cambiarRol } from "./actions";

export function CambiarRol({ rol, label, volver }: { rol: string; label: string; volver: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button size="lg" disabled={pending} onClick={() => startTransition(async () => setError(await cambiarRol(rol, volver)))}>
        Cambiar a {label}
      </Button>
    </>
  );
}
