"use client";

import { MessageCircle, Plus, RefreshCw, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { BotonCopiar, Dato } from "@/components/copiar";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { cn, fecha } from "@/lib/format";
import { ROLES_PROD1 } from "@/lib/prod1";
import type { Rol } from "@/lib/types";
import { celularLegible, contrasenaAlAzar, enlaceWhatsapp, mensajeContrasena, mensajeLink, MIN_CONTRASENA, normalizarCelular, ROL_LABEL } from "@/lib/usuarios";
import { cambiarActivo, crearUsuario, editarUsuario, generarLink, restablecerContrasena, type Acceso } from "./actions";

export type Usuario = {
  id: string;
  nombre: string;
  nombres: string;
  apellidos: string;
  email: string;
  dni: string;
  telefono: string;
  rol: Rol | null;
  /** Los demás roles de la persona (el de arriba es con el que trabaja ahora). */
  otrosRoles: Rol[];
  activo: boolean;
  ultimoIngreso: string | null;
  yo: boolean;
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function UsuariosLista({ usuarios }: { usuarios: Usuario[] }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<Usuario | "nuevo" | null>(null);
  const filtro = sinTildes(q.trim());
  const visibles = filtro ? usuarios.filter((u) => sinTildes(`${u.nombre} ${u.email} ${[u.rol, ...u.otrosRoles].map((r) => (r ? ROL_LABEL[r] : "")).join(" ")}`).includes(filtro)) : usuarios;

  return (
    <>
      <Input type="search" aria-label="Buscar usuario" placeholder="Nombre, correo o rol" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="overflow-hidden rounded-panel bg-surface">
        {visibles.map((u) => (
          <li key={u.id} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => setAbierto(u)}
              className={cn("flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink/8", !u.activo && "opacity-60")}
            >
              <Avatar semilla={u.id} nombre={u.nombre || u.email} size={38} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{u.nombre || "—"}</span>
                <span className="truncate text-[14px] text-ink-3">{u.email}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-right text-[14px] text-ink-2">{u.rol ? [u.rol, ...u.otrosRoles].map((r) => ROL_LABEL[r]).join(" · ") : "Sin perfil"}</span>
                {!u.activo && <span className="rounded-full bg-danger-bg px-2 text-[13px] font-semibold leading-5 text-danger">Desactivado</span>}
                {u.activo && u.rol && !ROLES_PROD1.includes(u.rol) && <span className="text-[13px] text-ink-3">Sin acceso</span>}
              </span>
            </button>
          </li>
        ))}
        {visibles.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin usuarios</li>}
      </ul>
      <Button
        aria-label="Nuevo usuario"
        onClick={() => setAbierto("nuevo")}
        className="fixed bottom-20 right-4 z-30 h-14 w-14 rounded-full p-0 shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={24} />
      </Button>
      {abierto === "nuevo" && <NuevoUsuario onClose={() => setAbierto(null)} />}
      {abierto && abierto !== "nuevo" && <FichaUsuario key={abierto.id} u={abierto} onClose={() => setAbierto(null)} />}
    </>
  );
}

const opcionesRol = (actual: Rol | null) =>
  [...ROLES_PROD1, ...(actual && !ROLES_PROD1.includes(actual) ? [actual] : [])].map((r) => ({ value: r, label: ROL_LABEL[r] }));

// DNI: 8 dígitos; obligatorio en Gerencia (va con su firma en los contratos).
const dniValido = (dni: string, gerencia: boolean) => (dni.trim() === "" ? !gerencia : /^\d{8}$/.test(dni.trim()));

/** Los demás roles de la persona (cambia entre ellos desde su menú). */
function CampoOtrosRoles({ rol, otros, setOtros }: { rol: string | null; otros: Rol[]; setOtros: (v: Rol[]) => void }) {
  return (
    <fieldset className="flex flex-col">
      <legend className="pb-1 text-[15px] font-medium">Otros roles</legend>
      {ROLES_PROD1.filter((r) => r !== rol).map((r) => (
        <label key={r} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span>{ROL_LABEL[r]}</span>
          <input
            type="checkbox"
            checked={otros.includes(r)}
            onChange={(e) => setOtros(e.target.checked ? [...otros, r] : otros.filter((x) => x !== r))}
            className="h-6 w-6 shrink-0 accent-primary"
          />
        </label>
      ))}
    </fieldset>
  );
}

function CampoDni({ dni, setDni, gerencia }: { dni: string; setDni: (v: string) => void; gerencia: boolean }) {
  return (
    <Field label={gerencia ? "DNI" : "DNI (opcional)"}>
      <Input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" className="num" />
    </Field>
  );
}

function CampoCelular({ telefono, setTelefono }: { telefono: string; setTelefono: (v: string) => void }) {
  return (
    <Field label="Celular (WhatsApp, opcional)">
      <Input
        value={telefono}
        onChange={(e) => setTelefono(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 18))}
        inputMode="tel"
        autoComplete="off"
        className="num"
        placeholder="987 654 321"
      />
    </Field>
  );
}
const celularValido = (t: string) => normalizarCelular(t) !== null;

/** Si el navegador tiene el menú de compartir del sistema (los teléfonos sí). */
const hayCompartir = () => typeof navigator !== "undefined" && typeof navigator.share === "function";
const sinSuscripcion = () => () => {};

/**
 * El acceso recién creado (link de un solo uso o contraseña temporal): se ve una sola vez, para pasárselo al usuario
 * (por WhatsApp a su celular, con el menú de compartir del teléfono —WhatsApp, Telegram, correo…— o copiándolo).
 */
function EntregaAcceso({ acceso, nombre, email, telefono }: { acceso: Acceso; nombre: string; email: string; telefono: string }) {
  const tel = normalizarCelular(telefono) || "";
  const puedeCompartir = useSyncExternalStore(sinSuscripcion, hayCompartir, () => false);
  const texto =
    "link" in acceso ? mensajeLink(nombre, acceso.link.url, acceso.link.vence) : mensajeContrasena(nombre, window.location.origin, email, acceso.contrasena);
  return (
    <section aria-label="Credenciales" className="flex flex-col gap-3 rounded-panel border border-line px-4 py-2">
      {"link" in acceso ? (
        <>
          <Dato label="Link de acceso (una sola vez)" valor={acceso.link.url} />
          <p className="num text-[14px] text-ink-3">Vence el {fecha(acceso.link.vence)}</p>
        </>
      ) : (
        <div>
          <Dato label="Correo" valor={email} />
          <Dato label="Contraseña" valor={acceso.contrasena} />
        </div>
      )}
      <div className="mb-2 flex flex-col gap-2">
        {tel && (
          <a
            href={enlaceWhatsapp(tel, texto)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Enviar por WhatsApp a ${celularLegible(tel)}`}
            className="flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-[#25D366] font-semibold text-white active:opacity-80"
          >
            <MessageCircle size={20} /> WhatsApp · <span className="num">{celularLegible(tel)}</span>
          </a>
        )}
        <div className="flex items-center gap-2">
          {/* El menú de compartir del teléfono: WhatsApp, Telegram, correo, SMS… (donde no lo hay, se copia). */}
          {puedeCompartir ? (
            <Button variant="secondary" className="flex-1" onClick={() => navigator.share({ title: "Acceso al ERP de Hogarian", text: texto }).catch(() => {})}>
              <Share2 size={18} /> Compartir
            </Button>
          ) : (
            <span className="flex-1 text-[14px] text-ink-3">Mensaje</span>
          )}
          <BotonCopiar valor={texto} label="mensaje" />
        </div>
      </div>
    </section>
  );
}

/** Cómo darle el acceso a una cuenta nueva. */
function ElegirAcceso({ acceso, setAcceso }: { acceso: "link" | "contrasena"; setAcceso: (a: "link" | "contrasena") => void }) {
  return (
    <div role="radiogroup" aria-label="Acceso" className="grid grid-cols-2 gap-1 rounded-control bg-sunken p-1">
      {(["link", "contrasena"] as const).map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={acceso === a}
          onClick={() => setAcceso(a)}
          className={cn("h-11 rounded-field px-2 text-[15px]", acceso === a ? "bg-surface font-semibold" : "text-ink-2")}
        >
          {a === "link" ? "Link de acceso" : "Contraseña"}
        </button>
      ))}
    </div>
  );
}

/** Nombres y apellidos, por separado. */
function CamposNombre({ nombres, setNombres, apellidos, setApellidos }: { nombres: string; setNombres: (v: string) => void; apellidos: string; setApellidos: (v: string) => void }) {
  return (
    <>
      <Field label="Nombres">
        <Input value={nombres} onChange={(e) => setNombres(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Apellidos">
        <Input value={apellidos} onChange={(e) => setApellidos(e.target.value)} autoComplete="off" />
      </Field>
    </>
  );
}
const unir = (n: string, a: string) => [n, a].map((x) => x.trim()).filter(Boolean).join(" ");

function NuevoUsuario({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [nombres, setNombres] = useState("");
  const [apellidos, setApellidos] = useState("");
  const nombre = unir(nombres, apellidos);
  const [email, setEmail] = useState("");
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [rol, setRol] = useState<string | null>(null);
  const [otros, setOtros] = useState<Rol[]>([]);
  const otrosRoles = otros.filter((r) => r !== rol);
  const gerencia = rol === "GERENCIA" || otrosRoles.includes("GERENCIA");
  const [modo, setModo] = useState<"link" | "contrasena">("link");
  const [contrasena, setContrasena] = useState(() => contrasenaAlAzar());
  const [creado, setCreado] = useState<Acceso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const crear = () =>
    startTransition(async () => {
      setError(null);
      const r = await crearUsuario({
        nombres,
        apellidos,
        email,
        dni,
        telefono,
        rol: (rol ?? "") as Rol,
        otrosRoles,
        acceso: modo,
        contrasena: modo === "contrasena" ? contrasena : "",
      });
      if (!r.ok) return setError(r.error);
      setCreado(r.data.acceso);
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={creado ? "Cuenta creada" : "Nuevo usuario"}
      footer={
        creado ? (
          <Button size="lg" onClick={onClose}>
            Listo
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={crear}
            disabled={
              pending ||
              nombres.trim().length < 2 ||
              !email.trim() ||
              !rol ||
              (modo === "contrasena" && contrasena.length < MIN_CONTRASENA) ||
              !dniValido(dni, gerencia) ||
              !celularValido(telefono)
            }
          >
            Crear cuenta
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {creado ? (
          <EntregaAcceso acceso={creado} nombre={nombre} email={email.trim().toLowerCase()} telefono={telefono} />
        ) : (
          <>
            <CamposNombre nombres={nombres} setNombres={setNombres} apellidos={apellidos} setApellidos={setApellidos} />
            <Field label="Correo">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" inputMode="email" />
            </Field>
            <Field label="Rol">
              <SearchSelect label="Rol" value={rol} onChange={setRol} options={opcionesRol(null)} placeholder="Elegir rol" />
            </Field>
            <CampoOtrosRoles rol={rol} otros={otrosRoles} setOtros={setOtros} />
            <CampoDni dni={dni} setDni={setDni} gerencia={gerencia} />
            <CampoCelular telefono={telefono} setTelefono={setTelefono} />
            <ElegirAcceso acceso={modo} setAcceso={setModo} />
            {/* Sin <label> envolvente: los botones de al lado no deben tomar su nombre. */}
            {modo === "contrasena" && (
              <div className="flex flex-col gap-1.5">
                <span id="contrasena-nueva" className="text-[15px] font-medium text-ink-2">
                  Contraseña
                </span>
                <div className="flex items-center gap-1">
                  <Input
                    aria-labelledby="contrasena-nueva"
                    value={contrasena}
                    onChange={(e) => setContrasena(e.target.value)}
                    autoComplete="new-password"
                    className="num flex-1"
                  />
                  <button
                    type="button"
                    aria-label="Generar otra contraseña"
                    onClick={() => setContrasena(contrasenaAlAzar())}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <BotonCopiar valor={contrasena} label="contraseña" />
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function FichaUsuario({ u, onClose }: { u: Usuario; onClose: () => void }) {
  const router = useRouter();
  const [nombres, setNombres] = useState(u.nombres);
  const [apellidos, setApellidos] = useState(u.apellidos);
  const [email, setEmail] = useState(u.email);
  const [dni, setDni] = useState(u.dni);
  const [telefono, setTelefono] = useState(u.telefono ? celularLegible(u.telefono) : "");
  const [rol, setRol] = useState<string | null>(u.rol);
  const [otros, setOtros] = useState<Rol[]>(u.otrosRoles);
  const otrosRoles = otros.filter((r) => r !== rol);
  const gerencia = rol === "GERENCIA" || otrosRoles.includes("GERENCIA");
  const [nueva, setNueva] = useState<Acceso | null>(null);
  const [confirmar, setConfirmar] = useState<"contrasena" | "link" | "activo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cambios =
    nombres.trim() !== u.nombres ||
    apellidos.trim() !== u.apellidos ||
    email.trim().toLowerCase() !== u.email ||
    rol !== u.rol ||
    [...otrosRoles].sort().join() !== [...u.otrosRoles].sort().join() ||
    dni.trim() !== u.dni ||
    (normalizarCelular(telefono) ?? "-") !== u.telefono;

  const correr = (accion: () => Promise<{ ok: true } | { ok: false; error: string }>, luego?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await accion();
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      luego?.();
      router.refresh();
    });

  const guardar = () => correr(() => editarUsuario({ id: u.id, nombres, apellidos, email, dni, telefono, rol: rol ?? "", otrosRoles }), onClose);
  const restablecer = () =>
    startTransition(async () => {
      setError(null);
      const r = await restablecerContrasena(u.id);
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      setNueva({ contrasena: r.data });
    });
  const link = () =>
    startTransition(async () => {
      setError(null);
      const r = await generarLink(u.id);
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      setNueva({ link: r.data });
    });
  const activar = () => correr(() => cambiarActivo(u.id, !u.activo), onClose);

  return (
    <Sheet
      open
      onClose={onClose}
      title={u.nombre || u.email}
      footer={
        <Button
          size="lg"
          onClick={guardar}
          disabled={pending || !cambios || nombres.trim().length < 2 || !email.trim() || !rol || !dniValido(dni, gerencia) || !celularValido(telefono)}
        >
          Guardar
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <CamposNombre nombres={nombres} setNombres={setNombres} apellidos={apellidos} setApellidos={setApellidos} />
        <Field label="Correo">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" inputMode="email" />
        </Field>
        <Field label="Rol">
          <SearchSelect label="Rol" value={rol} onChange={setRol} options={opcionesRol(u.rol)} placeholder="Elegir rol" />
        </Field>
        <CampoOtrosRoles rol={rol} otros={otrosRoles} setOtros={setOtros} />
        <CampoDni dni={dni} setDni={setDni} gerencia={gerencia} />
        <CampoCelular telefono={telefono} setTelefono={setTelefono} />
        <p className="num text-[14px] text-ink-3">Último ingreso: {u.ultimoIngreso ? fecha(u.ultimoIngreso) : "nunca"}</p>
        {nueva && <EntregaAcceso acceso={nueva} nombre={u.nombre} email={u.email} telefono={u.telefono} />}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmar("link")}>
            Link de acceso
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmar("contrasena")}>
            Restablecer contraseña
          </Button>
          {!u.yo && (
            <Button variant={u.activo ? "danger" : "secondary"} disabled={pending} onClick={() => setConfirmar("activo")}>
              {u.activo ? "Desactivar cuenta" : "Reactivar cuenta"}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
      <Confirm open={confirmar === "contrasena"} title="¿Restablecer la contraseña?" onYes={restablecer} onNo={() => setConfirmar(null)} pending={pending}>
        La contraseña actual deja de servir.
      </Confirm>
      <Confirm open={confirmar === "link"} title="¿Generar un link de acceso?" onYes={link} onNo={() => setConfirmar(null)} pending={pending}>
        Sirve una sola vez, durante 7 días: completa sus datos y crea su contraseña. Un link anterior deja de servir.
      </Confirm>
      <Confirm
        open={confirmar === "activo"}
        title={u.activo ? `¿Desactivar a ${u.nombre || u.email}?` : `¿Reactivar a ${u.nombre || u.email}?`}
        onYes={activar}
        onNo={() => setConfirmar(null)}
        pending={pending}
        danger={u.activo}
      >
        {u.activo ? "No podrá entrar ni ver datos." : "Podrá volver a entrar con su contraseña."}
      </Confirm>
    </Sheet>
  );
}
