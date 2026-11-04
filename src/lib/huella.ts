import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { origen } from "@/lib/auditoria";
import { APP_NOMBRE } from "@/lib/marca";
import { createAdminClient } from "@/lib/supabase/admin";

// Huella = passkey (WebAuthn) del dispositivo: el teléfono guarda la clave privada y solo la usa tras la huella
// o el rostro; el servidor guarda la pública y verifica cada firma. Los desafíos son de un solo uso, viven en la
// base 5 minutos y la cookie solo lleva su id.

const COOKIE_DESAFIO = "prod1_huella_desafio";
/** Topes de desafíos sin sesión vigentes (pedir opciones para entrar es público): por IP, para que un script no
 *  agote el tope de todos (con solo uno global, 300 llamadas dejaban a nadie entrar con huella), y uno total. */
const MAX_DESAFIOS_POR_IP = 20;
const MAX_DESAFIOS_ANONIMOS = 2000;

/** Origen de la petición y su dominio (RP ID): Vercel, el túnel o localhost. Next ya validó el origen. */
async function sitio() {
  const origin = (await headers()).get("origin");
  if (!origin) throw new Error("Petición sin origen");
  const u = new URL(origin);
  return { origin: u.origin, rpID: u.hostname };
}

async function guardarDesafio(challenge: string, userId: string | null) {
  const db = createAdminClient(userId ?? undefined);
  // Los vencidos se borran después de responder (no alargan la espera de la huella).
  after(async () => {
    await db.from("huella_desafios").delete().lt("expira_at", new Date().toISOString());
  });
  const { ip } = await origen();
  if (!userId) {
    const anonimos = () => db.from("huella_desafios").select("id", { count: "exact", head: true }).is("user_id", null);
    const [{ count: deLaIp }, { count: total }] = await Promise.all([
      ip ? anonimos().eq("ip", ip) : Promise.resolve({ count: 0 }),
      anonimos(),
    ]);
    if ((deLaIp ?? 0) >= MAX_DESAFIOS_POR_IP || (total ?? 0) >= MAX_DESAFIOS_ANONIMOS) throw new Error("Demasiados intentos, espera unos minutos");
  }
  const { data, error } = await db.from("huella_desafios").insert({ challenge, user_id: userId, ip }).select("id").single();
  if (error) throw new Error(error.message);
  (await cookies()).set(COOKIE_DESAFIO, data.id, { httpOnly: true, secure: true, sameSite: "strict", maxAge: 300, path: "/" });
}

/** Toma (y borra) el desafío de la cookie: solo vale una vez, sin vencer y para el mismo usuario. */
async function tomarDesafio(userId: string | null): Promise<string | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE_DESAFIO)?.value;
  jar.delete(COOKIE_DESAFIO);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createAdminClient(userId ?? undefined)
    .from("huella_desafios")
    .delete()
    .eq("id", id)
    .select("challenge, user_id, expira_at")
    .maybeSingle();
  if (!data || new Date(data.expira_at) < new Date() || data.user_id !== userId) return null;
  return data.challenge;
}

export type Huella = { id: string; credentialId: string; dispositivo: string | null; creada: string; usada: string | null };

export async function huellasDe(userId: string): Promise<Huella[]> {
  const { data } = await createAdminClient()
    .from("huellas")
    .select("id, credential_id, dispositivo, created_at, usada_at")
    .eq("user_id", userId)
    .order("created_at");
  return (data ?? []).map((h) => ({
    id: h.id,
    credentialId: h.credential_id,
    dispositivo: h.dispositivo,
    creada: h.created_at,
    usada: h.usada_at,
  }));
}

export async function opcionesActivar(u: { id: string; email: string; nombre: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = await sitio();
  const { data: ya } = await createAdminClient().from("huellas").select("credential_id, transports").eq("user_id", u.id).eq("rp_id", rpID);
  const opciones = await generateRegistrationOptions({
    rpName: APP_NOMBRE,
    rpID,
    userName: u.email,
    userDisplayName: u.nombre,
    userID: isoUint8Array.fromUTF8String(u.id),
    attestationType: "none",
    excludeCredentials: (ya ?? []).map((c) => ({ id: c.credential_id, transports: c.transports })),
    // La del propio teléfono (huella o rostro), que se pueda elegir sin escribir el correo.
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
  });
  await guardarDesafio(opciones.challenge, u.id);
  return opciones;
}

export async function verificarActivacion(userId: string, respuesta: RegistrationResponseJSON, dispositivo: string | null) {
  const challenge = await tomarDesafio(userId);
  if (!challenge) return null;
  const { origin, rpID } = await sitio();
  const v = await verifyRegistrationResponse({
    response: respuesta,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).catch(() => null);
  if (!v?.verified) return null;
  const c = v.registrationInfo.credential;
  const { data, error } = await createAdminClient(userId ?? undefined)
    .from("huellas")
    .insert({
      user_id: userId,
      credential_id: c.id,
      public_key: isoBase64URL.fromBuffer(c.publicKey),
      counter: c.counter,
      transports: c.transports ?? [],
      rp_id: rpID,
      dispositivo,
    })
    .select("id, credential_id")
    .single();
  if (error) return null;
  return data;
}

/** Opciones para firmar: al entrar (userId null: cualquier huella de este dominio) o al desbloquear (las suyas). */
export async function opcionesFirmar(userId: string | null): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const { rpID } = await sitio();
  let allowCredentials: { id: string; transports?: string[] }[] | undefined;
  if (userId) {
    const { data } = await createAdminClient().from("huellas").select("credential_id, transports").eq("user_id", userId).eq("rp_id", rpID);
    if (!data?.length) return null;
    allowCredentials = data.map((c) => ({ id: c.credential_id, transports: c.transports }));
  }
  const opciones = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials });
  await guardarDesafio(opciones.challenge, userId);
  return opciones;
}

export type Firma = { ok: true; userId: string } | { ok: false; desconocida: boolean };

/**
 * Verifica la firma de una huella y devuelve su dueño. Con userId, debe ser suya. «desconocida»: la credencial
 * ya no está (se quitó desde otro dispositivo): el teléfono deja de ofrecerla.
 */
export async function verificarFirma(respuesta: AuthenticationResponseJSON, userId: string | null): Promise<Firma> {
  const fallo = { ok: false, desconocida: false } as const;
  const db = createAdminClient(userId ?? undefined);
  // El desafío y la credencial, a la vez.
  const [challenge, { data: c }] = await Promise.all([
    tomarDesafio(userId),
    db
      .from("huellas")
      .select("id, user_id, credential_id, public_key, counter, transports, rp_id")
      .eq("credential_id", String(respuesta.id ?? ""))
      .maybeSingle(),
  ]);
  if (!challenge) return fallo;
  if (!c) return { ok: false, desconocida: true };
  if (userId && c.user_id !== userId) return fallo;
  const { origin } = await sitio();
  const v = await verifyAuthenticationResponse({
    response: respuesta,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: c.rp_id,
    credential: {
      id: c.credential_id,
      publicKey: isoBase64URL.toBuffer(c.public_key),
      counter: Number(c.counter),
      transports: c.transports,
    },
    requireUserVerification: true,
  }).catch(() => null);
  if (!v?.verified) return fallo;
  // El contador y «usada» se guardan después de responder.
  const usada = new Date().toISOString();
  after(async () => {
    await createAdminClient(c.user_id).from("huellas").update({ counter: v.authenticationInfo.newCounter, usada_at: usada }).eq("id", c.id);
  });
  return { ok: true, userId: c.user_id };
}
