"use client";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  activarHuella,
  desbloquear,
  entrarConHuella,
  misHuellas,
  opcionesActivarHuella,
  opcionesDesbloquear,
  opcionesEntrar,
  quitarHuella,
} from "@/app/login/huella-actions";
import { logout } from "@/app/login/actions";
import { CLAVE_ABIERTA, CLAVE_HUELLA, RUTAS_LIBRES, quitarVelo } from "@/lib/bloqueo";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

// Huella en este dispositivo: qué usuario la activó (para ofrecerla al entrar y bloquear la app al volver).
const CLAVE = CLAVE_HUELLA;
const VISTO = "prod1_huella_visto"; // última vez que la app estuvo a la vista (localStorage)
const ABIERTA = CLAVE_ABIERTA; // esta pestaña ya entró o se desbloqueó (sessionStorage)
const SALIO = "prod1_salio"; // cerró sesión a propósito: no pedir la huella sola al volver al login
const NO_OFRECER = "prod1_huella_no";
// Al abrir la app siempre pide la huella; al volver de otra app, si estuvo fuera más de esto (salir un momento a
// WhatsApp a mandar un link no la pide).
const ESPERA = 60_000;

type Marca = { u: string; e: string; c: string };

const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((l) => l());
const suscribir = (l: () => void) => {
  oyentes.add(l);
  return () => oyentes.delete(l);
};
const crudo = () => {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
};
const marcaDe = (s: string | null): Marca | null => {
  try {
    const m = JSON.parse(s ?? "null");
    return m?.u ? m : null;
  } catch {
    return null;
  }
};
function guardar(m: Marca | null) {
  try {
    if (m) localStorage.setItem(CLAVE, JSON.stringify(m));
    else localStorage.removeItem(CLAVE);
  } catch {}
  avisar();
}
function abierta() {
  try {
    sessionStorage.setItem(ABIERTA, "1");
    localStorage.setItem(VISTO, String(Date.now()));
  } catch {}
}
const entro = () => {
  try {
    sessionStorage.removeItem(SALIO);
  } catch {}
  abierta();
};
/** Al cerrar sesión a propósito: el login no pide la huella solo. */
export function marcarSalida() {
  try {
    sessionStorage.setItem(SALIO, "1");
    sessionStorage.removeItem(ABIERTA);
  } catch {}
}
/** Entró con contraseña: si es otra persona, la huella de este dispositivo ya no se ofrece. */
export function entroConContrasena(email: string) {
  const m = marcaDe(crudo());
  if (m && m.e.toLowerCase() !== email.trim().toLowerCase()) guardar(null);
  entro();
}

const cancelada = (e: unknown) => e instanceof WebAuthnError ? e.name === "NotAllowedError" || e.code === "ERROR_CEREMONY_ABORTED" : e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");

/**
 * Activa la huella de este dispositivo para el usuario de la sesión. Devuelve null si salió bien o si la canceló;
 * si ya estaba activada aquí (una de sus huellas vive en este teléfono), solo la marca.
 */
async function activarAqui(): Promise<string | null> {
  try {
    const r = await activarHuella(await startRegistration({ optionsJSON: await opcionesActivarHuella() }));
    if (!r) return "No se pudo activar";
    guardar({ u: r.userId, e: r.email, c: r.credentialId });
    abierta();
    return null;
  } catch (e) {
    if (e instanceof WebAuthnError && e.name === "InvalidStateError") {
      const yo = await misHuellas();
      guardar({ u: yo.userId, e: yo.email, c: "" });
      abierta();
      return null;
    }
    return cancelada(e) ? null : "No se pudo activar";
  }
}

function useMarca() {
  const s = useSyncExternalStore(suscribir, crudo, () => null);
  return useMemo(() => marcaDe(s), [s]);
}

// ── Login ──

export function EntrarConHuella({ disabled }: { disabled?: boolean }) {
  const marca = useMarca();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sola = useRef(false);

  // sola: la pidió el login al abrirse; si no se pudo (o la cancelaron), no hay nada que avisar.
  const entrar = (sola = false) =>
    startTransition(async () => {
      setError(null);
      try {
        const opciones = await opcionesEntrar();
        if (!opciones) return;
        const respuesta = await startAuthentication({ optionsJSON: opciones });
        entro();
        const r = await entrarConHuella(respuesta);
        // Si entra, el servidor redirige; si vuelve, falló.
        if (r.desconocida) guardar(null);
        setError(r.error);
      } catch (e) {
        if (!sola && !cancelada(e)) setError("No se pudo usar la huella");
      }
    });

  // Al abrir el login con la huella activada, la pide sola (salvo que haya cerrado sesión a propósito).
  useEffect(() => {
    if (!marca || sola.current || !browserSupportsWebAuthn()) return;
    sola.current = true;
    let salio = false;
    try {
      salio = sessionStorage.getItem(SALIO) === "1";
    } catch {}
    if (!salio) entrar(true);
  }, [marca]);

  if (!marca && !error) return null;
  return (
    <div className="flex flex-col gap-2">
      {marca && (
        <Button type="button" variant="secondary" size="lg" disabled={disabled || pending} onClick={() => entrar()}>
          <Fingerprint size={22} />
          Entrar con huella
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// ── Menú del usuario ──

const fecha = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Lima" });

export function HuellaSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const marca = useMarca();
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof misHuellas>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [soporta, setSoporta] = useState(false);
  useEffect(() => {
    misHuellas().then(setDatos);
    platformAuthenticatorIsAvailable().then(setSoporta).catch(() => setSoporta(false));
  }, []);

  const aqui = marca?.u === userId;
  const activar = () =>
    startTransition(async () => {
      setError(await activarAqui());
      setDatos(await misHuellas());
    });
  const quitar = (id: string, credentialId: string) =>
    startTransition(async () => {
      if (!(await quitarHuella(id))) return setError("No se pudo quitar");
      if (marca && (marca.c === credentialId || marca.c === "")) guardar(null);
      setDatos(await misHuellas());
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Huella"
      footer={
        soporta && !aqui ? (
          <Button size="lg" onClick={activar} disabled={pending || !datos}>
            <Fingerprint size={22} />
            Activar en este dispositivo
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 p-4">
        {!datos ? (
          <p className="text-ink-3">Cargando…</p>
        ) : datos.huellas.length === 0 ? (
          <p className="text-ink-3">Sin dispositivos</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {datos.huellas.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-panel bg-surface p-3">
                <Fingerprint size={22} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">
                    {h.dispositivo ?? "Dispositivo"}
                    {aqui && marca?.c === h.credentialId ? " · este" : ""}
                  </span>
                  <span className="num text-[14px] text-ink-3">
                    {fecha.format(new Date(h.creada))}
                    {h.usada ? ` · usada ${fecha.format(new Date(h.usada))}` : ""}
                  </span>
                </span>
                <Button variant="ghost" className="text-danger" disabled={pending} onClick={() => quitar(h.id, h.credentialId)}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!soporta && datos && <p className="text-ink-3">Este dispositivo no tiene huella</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}

// ── Bloqueo al volver a la app (y oferta de activarla en la app instalada) ──

const instalada = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function BloqueoHuella() {
  const path = usePathname();
  const libre = RUTAS_LIBRES.some((r) => path === r || path.startsWith(`${r}/`));
  const marca = useMarca();
  const [bloqueada, setBloqueada] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [ofrecer, setOfrecer] = useState(false);

  useEffect(() => {
    // Desde el login se entra con contraseña o huella: lo que siga ya está desbloqueado.
    if (libre) {
      if (path === "/login") abierta();
      quitarVelo();
      return;
    }
    const visto = () => {
      try {
        return Number(localStorage.getItem(VISTO) ?? 0);
      } catch {
        return 0;
      }
    };
    const revisar = (siempre: boolean) => {
      if (marcaDe(crudo()) && (siempre || Date.now() - visto() > ESPERA)) setBloqueada(true);
    };
    let yaAbierta = false;
    try {
      yaAbierta = sessionStorage.getItem(ABIERTA) === "1";
    } catch {}
    // Recién abierta (esta pestaña o la app no había entrado ni se había desbloqueado): siempre.
    if (!yaAbierta) revisar(true);
    if (yaAbierta || !marcaDe(crudo())) quitarVelo();
    const alCambiar = () => {
      if (document.visibilityState === "visible") revisar(false);
      else
        try {
          localStorage.setItem(VISTO, String(Date.now()));
        } catch {}
    };
    const alSalir = () => {
      try {
        localStorage.setItem(VISTO, String(Date.now()));
      } catch {}
    };
    document.addEventListener("visibilitychange", alCambiar);
    window.addEventListener("pagehide", alSalir);
    return () => {
      document.removeEventListener("visibilitychange", alCambiar);
      window.removeEventListener("pagehide", alSalir);
    };
  }, [libre, path]);

  // En la app instalada, si el teléfono tiene huella y aún no se activó, la ofrece una vez.
  useEffect(() => {
    if (libre || marca || !browserSupportsWebAuthn() || !instalada()) return;
    try {
      if (localStorage.getItem(NO_OFRECER)) return;
    } catch {}
    platformAuthenticatorIsAvailable().then((s) => s && setOfrecer(true)).catch(() => {});
  }, [libre, marca]);

  if (libre) return null;
  if (bloqueada)
    return (
      <Bloqueo
        error={fallo}
        onAbrir={() => {
          setBloqueada(false);
          quitarVelo();
        }}
        // La verificación del servidor llega después de abrir: si la rechaza, vuelve a bloquear.
        onFallo={(e) => {
          setFallo(e);
          setBloqueada(true);
        }}
      />
    );
  if (ofrecer) return <OfrecerHuella onClose={() => setOfrecer(false)} />;
  return null;
}

/**
 * Pantalla de bloqueo. Abre apenas el teléfono acepta la huella (la firma ya la hizo el teléfono tras la huella) y
 * el servidor la verifica después: si la rechaza, vuelve a bloquear (onFallo). Así se ahorra un viaje de espera.
 */
function Bloqueo({ error: inicial, onAbrir, onFallo }: { error: string | null; onAbrir: () => void; onFallo: (e: string) => void }) {
  const [error, setError] = useState<string | null>(inicial);
  const [pending, startTransition] = useTransition();
  const sola = useRef(false);
  const abrir = () =>
    startTransition(async () => {
      setError(null);
      try {
        const opciones = await opcionesDesbloquear();
        // La sesión es de otra persona (sin huella aquí): no hay nada que pedir.
        if (!opciones) return (abierta(), onAbrir());
        const respuesta = await startAuthentication({ optionsJSON: opciones });
        abierta();
        onAbrir();
        desbloquear(respuesta)
          .then((ok) => {
            if (ok) return;
            try {
              sessionStorage.removeItem(ABIERTA);
            } catch {}
            onFallo("No se reconoció la huella");
          })
          .catch(() => {});
      } catch (e) {
        if (!cancelada(e)) setError("No se pudo usar la huella");
      }
    });
  useEffect(() => {
    // Tras un rechazo del servidor no la pide sola (se tocaría en bucle): se toca el botón.
    if (sola.current || inicial) return;
    sola.current = true;
    abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una sola vez al bloquearse
  }, []);
  return (
    <div data-bloqueo-pantalla role="dialog" aria-modal="true" aria-label="App bloqueada" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-bg px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <Logo />
      <button
        type="button"
        onClick={abrir}
        disabled={pending}
        aria-label="Desbloquear con huella"
        className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-primary-ink active:scale-95 disabled:opacity-60"
      >
        <Fingerprint size={48} />
      </button>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <form action={logout} onSubmit={marcarSalida}>
        <button type="submit" className="h-12 px-4 font-semibold text-ink-2">
          Usar contraseña
        </button>
      </form>
    </div>
  );
}

/** Se pregunta una sola vez por dispositivo (luego queda en el menú › Huella). */
function OfrecerHuella({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cerrar = () => {
    try {
      localStorage.setItem(NO_OFRECER, "1");
    } catch {}
    onClose();
  };
  const activar = () =>
    startTransition(async () => {
      const e = await activarAqui();
      if (e) return setError(e);
      if (marcaDe(crudo())) cerrar();
    });
  return (
    <Sheet
      open
      onClose={cerrar}
      title="Desbloquear con huella"
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={activar} disabled={pending}>
            <Fingerprint size={22} />
            Activar
          </Button>
          <Button size="lg" variant="ghost" onClick={cerrar}>
            Ahora no
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 p-6 text-primary">
        <Fingerprint size={64} />
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
