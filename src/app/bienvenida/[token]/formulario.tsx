"use client";

import { Fingerprint } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { activarAqui } from "@/components/huella";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { MIN_CONTRASENA, normalizarCelular } from "@/lib/usuarios";
import { completarBienvenida } from "../actions";

/** Si el navegador tiene huella o rostro (passkeys). */
const conHuella = () => typeof window !== "undefined" && "PublicKeyCredential" in window;
const sinSuscripcion = () => () => {};

/** Sus datos (solo esta vez) y su contraseña; luego, si el teléfono puede, la huella. */
export function FormularioBienvenida({
  token,
  email,
  dniObligatorio,
  inicial,
  usado = false,
}: {
  token: string;
  email: string;
  dniObligatorio: boolean;
  inicial: { nombres: string; dni: string; telefono: string };
  /** El link ya se usó (en esta misma sesión, recién): queda el paso de la huella. */
  usado?: boolean;
}) {
  const router = useRouter();
  const [nombres, setNombres] = useState(inicial.nombres);
  const [apellidos, setApellidos] = useState("");
  const [dni, setDni] = useState(inicial.dni);
  const [telefono, setTelefono] = useState(inicial.telefono);
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [paso, setPaso] = useState<"datos" | "huella">(usado ? "huella" : "datos");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const puedeHuella = useSyncExternalStore(sinSuscripcion, conHuella, () => false);
  const distintas = repetida !== "" && repetida !== clave;

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await completarBienvenida(token, { nombres, apellidos, dni, telefono, clave });
      if ("error" in r) return setError(r.error);
      if (puedeHuella) setPaso("huella");
      else router.replace("/");
    });
  const activar = () =>
    startTransition(async () => {
      setError(null);
      const e = await activarAqui();
      if (e) return setError(e);
      router.replace("/");
    });

  if (paso === "huella")
    return (
      <div className="flex flex-col gap-6">
        <h1 className="rotulo text-[30px] font-semibold leading-tight text-ink-2">Entrar con huella</h1>
        <div className="flex justify-center text-primary">
          <Fingerprint size={64} />
        </div>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={activar} disabled={pending}>
            <Fingerprint size={22} /> Activar huella
          </Button>
          <Button size="lg" variant="ghost" onClick={() => router.replace("/")} disabled={pending}>
            Ahora no
          </Button>
        </div>
      </div>
    );

  const listo =
    nombres.trim().length >= 2 &&
    apellidos.trim().length >= 2 &&
    (dniObligatorio ? /^\d{8}$/.test(dni) : /^(\d{8})?$/.test(dni)) &&
    normalizarCelular(telefono) !== null &&
    clave.length >= MIN_CONTRASENA &&
    clave === repetida;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (listo) guardar();
      }}
    >
      <h1 className="rotulo text-[30px] font-semibold leading-tight text-ink-2">Bienvenido</h1>
      <p className="num break-all text-ink-2">{email}</p>
      <Field label="Nombres">
        <Input value={nombres} onChange={(e) => setNombres(e.target.value)} autoComplete="given-name" />
      </Field>
      <Field label="Apellidos">
        <Input value={apellidos} onChange={(e) => setApellidos(e.target.value)} autoComplete="family-name" />
      </Field>
      <Field label={dniObligatorio ? "DNI" : "DNI (opcional)"}>
        <Input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" className="num" />
      </Field>
      <Field label="Celular (opcional)">
        <Input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 18))}
          inputMode="tel"
          autoComplete="tel"
          className="num"
          placeholder="987 654 321"
        />
      </Field>
      {/* El correo, para que el gestor de contraseñas del teléfono la guarde con su cuenta. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field label={`Contraseña (mín. ${MIN_CONTRASENA}, con letras y números)`}>
        <PasswordInput value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Repetir la contraseña">
        <PasswordInput value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" aria-invalid={distintas} />
      </Field>
      {distintas && <p className="text-danger">No coinciden</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending || !listo}>
        Guardar y entrar
      </Button>
    </form>
  );
}
