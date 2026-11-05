"use client";

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  activarHuella,
  entrarConHuella,
  misHuellas,
  opcionesActivarHuella,
  opcionesEntrar,
  quitarHuella,
  yaActivadaAqui,
} from "@/app/login/huella-actions";
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
// Latido mientras la app está a la vista: el servidor renueva el «desbloqueado» (vence a los 3 min sin actividad).
const LATIDO = 60_000;

// Desbloquear va por rutas bajo /desbloquear (no server actions): funcionan aunque el «desbloqueado» del servidor
// haya vencido, y el servidor solo desbloquea tras verificar la huella.
/** Sin sesión (venció): hay que volver a entrar. */
class SinSesion extends Error {}
async function opcionesDesbloqueo(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const r = await fetch("/desbloquear/opciones", { method: "POST" });
  if (r.status === 401) throw new SinSesion();
  if (!r.ok) throw new Error("No se pudo desbloquear");
  return ((await r.json()) as { opciones: PublicKeyCredentialRequestOptionsJSON | null }).opciones;
}
async function verificarDesbloqueo(respuesta: AuthenticationResponseJSON): Promise<boolean> {
  const r = await fetch("/desbloquear/verificar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(respuesta) });
  return r.ok && ((await r.json()) as { ok: boolean }).ok === true;
}

/** «Usar contraseña»: cierra la sesión (un formulario a una ruta: funciona también con la pantalla bloqueada). */
function UsarContrasena() {
  return (
    <form method="post" action="/login/salir" onSubmit={marcarSalida}>
      <button type="submit" className="h-12 px-4 font-semibold text-ink-2">
        Usar contraseña
      </button>
    </form>
  );
}

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
export async function activarAqui(): Promise<string | null> {
  try {
    const r = await activarHuella(await startRegistration({ optionsJSON: await opcionesActivarHuella() }));
    if (!r) return "No se pudo activar";
    guardar({ u: r.userId, e: r.email, c: r.credentialId });
    abierta();
    return null;
  } catch (e) {
    if (e instanceof WebAuthnError && e.name === "InvalidStateError") {
      const yo = await misHuellas();
      await yaActivadaAqui();
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
      const deEste = !!marca && (marca.c === credentialId || marca.c === "");
      if (!(await quitarHuella(id, deEste))) return setError("No se pudo quitar");
      if (deEste) guardar(null);
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
    // Latido: mantiene vivo el «desbloqueado» del servidor mientras la app está a la vista; si ya venció (401), se
    // bloquea aquí también.
    const latido = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !marcaDe(crudo())) return;
      void fetch("/vivo", { method: "POST" })
        .then((r) => {
          if (r.status !== 401) return;
          try {
            sessionStorage.removeItem(ABIERTA);
          } catch {}
          setBloqueada(true);
        })
        .catch(() => {});
    }, LATIDO);
    return () => {
      document.removeEventListener("visibilitychange", alCambiar);
      window.removeEventListener("pagehide", alSalir);
      window.clearInterval(latido);
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
  const router = useRouter();
  const [error, setError] = useState<string | null>(inicial);
  const [pending, startTransition] = useTransition();
  const sola = useRef(false);
  const abrir = () =>
    startTransition(async () => {
      setError(null);
      try {
        const opciones = await opcionesDesbloqueo();
        // Sin huella que pedir (la sesión es de otra persona, o se quitó): el servidor ya desbloqueó.
        if (!opciones) return (abierta(), onAbrir());
        const respuesta = await startAuthentication({ optionsJSON: opciones });
        abierta();
        onAbrir();
        verificarDesbloqueo(respuesta)
          .then((ok) => {
            if (ok) return;
            try {
              sessionStorage.removeItem(ABIERTA);
            } catch {}
            onFallo("No se reconoció la huella");
          })
          .catch(() => {});
      } catch (e) {
        if (e instanceof SinSesion) return router.replace("/login");
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
      <UsarContrasena />
    </div>
  );
}

/**
 * La pantalla /desbloquear: adonde manda el servidor cuando venció el «desbloqueado» (no hay nada detrás). Aquí no
 * se abre antes de tiempo: espera a que el servidor verifique la huella y vuelve a la pantalla pedida.
 */
export function PantallaDesbloqueo({ volver }: { volver: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sola = useRef(false);
  const abrir = () =>
    startTransition(async () => {
      setError(null);
      try {
        const opciones = await opcionesDesbloqueo();
        if (opciones && !(await verificarDesbloqueo(await startAuthentication({ optionsJSON: opciones })))) {
          return setError("No se reconoció la huella");
        }
        abierta();
        router.replace(volver);
      } catch (e) {
        if (e instanceof SinSesion) return router.replace("/login");
        if (!cancelada(e)) setError("No se pudo usar la huella");
      }
    });
  useEffect(() => {
    if (sola.current) return;
    sola.current = true;
    abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una sola vez al abrir
  }, []);
  return (
    <main aria-label="App bloqueada" className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-bg px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
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
      <UsarContrasena />
    </main>
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
