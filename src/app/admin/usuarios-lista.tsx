"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { contrasenaAlAzar, MIN_CONTRASENA, ROL_LABEL } from "@/lib/usuarios";
import { cambiarActivo, crearUsuario, editarUsuario, restablecerContrasena } from "./actions";

export type Usuario = {
  id: string;
  nombre: string;
  email: string;
  dni: string;
  rol: Rol | null;
  activo: boolean;
  ultimoIngreso: string | null;
  yo: boolean;
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function UsuariosLista({ usuarios }: { usuarios: Usuario[] }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<Usuario | "nuevo" | null>(null);
  const filtro = sinTildes(q.trim());
  const visibles = filtro
    ? usuarios.filter((u) => sinTildes(`${u.nombre} ${u.email} ${u.rol ? ROL_LABEL[u.rol] : ""}`).includes(filtro))
    : usuarios;

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
                <span className="text-[14px] text-ink-2">{u.rol ? ROL_LABEL[u.rol] : "Sin perfil"}</span>
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
const dniValido = (dni: string, rol: string | null) => (dni.trim() === "" ? rol !== "GERENCIA" : /^\d{8}$/.test(dni.trim()));

function CampoDni({ dni, setDni, rol }: { dni: string; setDni: (v: string) => void; rol: string | null }) {
  return (
    <Field label={rol === "GERENCIA" ? "DNI" : "DNI (opcional)"}>
      <Input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" className="num" />
    </Field>
  );
}

/** Contraseña recién creada o restablecida: se ve una sola vez, para pasársela al usuario. */
function Credenciales({ email, contrasena }: { email: string; contrasena: string }) {
  return (
    <section aria-label="Credenciales" className="rounded-panel border border-line px-4 py-1">
      <Dato label="Correo" valor={email} />
      <Dato label="Contraseña" valor={contrasena} />
    </section>
  );
}

function NuevoUsuario({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [dni, setDni] = useState("");
  const [rol, setRol] = useState<string | null>(null);
  const [contrasena, setContrasena] = useState(() => contrasenaAlAzar());
  const [creado, setCreado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const crear = () =>
    startTransition(async () => {
      setError(null);
      const r = await crearUsuario({ nombre, email, dni, rol: (rol ?? "") as Rol, contrasena });
      if (!r.ok) return setError(r.error);
      setCreado(true);
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
            disabled={pending || !nombre.trim() || !email.trim() || !rol || contrasena.length < MIN_CONTRASENA || !dniValido(dni, rol)}
          >
            Crear cuenta
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {creado ? (
          <Credenciales email={email.trim().toLowerCase()} contrasena={contrasena} />
        ) : (
          <>
            <Field label="Nombre">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Correo">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" inputMode="email" />
            </Field>
            <Field label="Rol">
              <SearchSelect label="Rol" value={rol} onChange={setRol} options={opcionesRol(null)} placeholder="Elegir rol" />
            </Field>
            <CampoDni dni={dni} setDni={setDni} rol={rol} />
            {/* Sin <label> envolvente: los botones de al lado no deben tomar su nombre. */}
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
          </>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}

function FichaUsuario({ u, onClose }: { u: Usuario; onClose: () => void }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(u.nombre);
  const [email, setEmail] = useState(u.email);
  const [dni, setDni] = useState(u.dni);
  const [rol, setRol] = useState<string | null>(u.rol);
  const [nueva, setNueva] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<"contrasena" | "activo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cambios = nombre.trim() !== u.nombre || email.trim().toLowerCase() !== u.email || rol !== u.rol || dni.trim() !== u.dni;

  const correr = (accion: () => Promise<{ ok: true } | { ok: false; error: string }>, luego?: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await accion();
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      luego?.();
      router.refresh();
    });

  const guardar = () => correr(() => editarUsuario({ id: u.id, nombre, email, dni, rol: rol ?? "" }), onClose);
  const restablecer = () =>
    startTransition(async () => {
      setError(null);
      const r = await restablecerContrasena(u.id);
      setConfirmar(null);
      if (!r.ok) return setError(r.error);
      setNueva(r.data);
    });
  const activar = () => correr(() => cambiarActivo(u.id, !u.activo), onClose);

  return (
    <Sheet
      open
      onClose={onClose}
      title={u.nombre || u.email}
      footer={
        <Button size="lg" onClick={guardar} disabled={pending || !cambios || !nombre.trim() || !email.trim() || !rol || !dniValido(dni, rol)}>
          Guardar
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Nombre">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Correo">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" inputMode="email" />
        </Field>
        <Field label="Rol">
          <SearchSelect label="Rol" value={rol} onChange={setRol} options={opcionesRol(u.rol)} placeholder="Elegir rol" />
        </Field>
        <CampoDni dni={dni} setDni={setDni} rol={rol} />
        <p className="num text-[14px] text-ink-3">Último ingreso: {u.ultimoIngreso ? fecha(u.ultimoIngreso) : "nunca"}</p>
        {nueva && <Credenciales email={u.email} contrasena={nueva} />}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmar("contrasena")}>
            Restablecer contraseña
          </Button>
          {!u.yo && (
            <Button variant={u.activo ? "danger" : "secondary"} disabled={pending} onClick={() => setConfirmar("activo")}>
              {u.activo ? "Desactivar cuenta" : "Reactivar cuenta"}
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
      <Confirm
        open={confirmar === "contrasena"}
        title="¿Restablecer la contraseña?"
        onYes={restablecer}
        onNo={() => setConfirmar(null)}
        pending={pending}
      >
        La contraseña actual deja de servir.
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
