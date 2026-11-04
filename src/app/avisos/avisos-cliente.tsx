"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { guardarSuscripcion, marcarLeidas } from "./actions";

/** Al abrir la lista, los avisos quedan leídos (la campana se actualiza sola). */
export function MarcarLeidas() {
  useEffect(() => {
    void marcarLeidas();
  }, []);
  return null;
}

const soportado = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const permiso = () => (soportado() ? Notification.permission : "unsupported");
const sinSuscripcion = () => () => {};

function claveVapid(base64: string) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Botón para recibir los avisos como notificación en este dispositivo (se oculta si ya están activas). */
export function ActivarPush() {
  const estadoInicial = useSyncExternalStore(sinSuscripcion, permiso, () => "unsupported");
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const actual = estado ?? estadoInicial;

  // Con permiso ya dado, se asegura que el service worker y la suscripción estén al día.
  useEffect(() => {
    if (estadoInicial === "granted") void suscribir().catch(() => {});
  }, [estadoInicial]);

  if (actual === "unsupported" || actual === "granted") return null;
  if (actual === "denied") {
    return <p className="rounded-panel bg-surface px-4 py-3 text-ink-2">Las notificaciones están bloqueadas en este navegador.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const p = await Notification.requestPermission();
            setEstado(p);
            if (p !== "granted") return;
            try {
              await suscribir();
            } catch (e) {
              setError(e instanceof Error ? e.message : "No se pudo activar");
            }
          })
        }
      >
        <BellRing size={18} /> Activar notificaciones
      </Button>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  );
}

async function suscribir() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveVapid(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    }));
  const err = await guardarSuscripcion(JSON.parse(JSON.stringify(sub)));
  if (err) throw new Error(err);
}
