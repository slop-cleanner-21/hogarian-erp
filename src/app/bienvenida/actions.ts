"use server";

import { registrarEvento } from "@/lib/auditoria";
import { hashToken, leerInvitacion } from "@/lib/bienvenida";
import { marcarDesbloqueo } from "@/lib/bloqueo-cookies";
import { marcarConocido } from "@/lib/dispositivo-conocido";
import { abrirSesion } from "@/lib/sesion-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { contrasenaValida, normalizarCelular } from "@/lib/usuarios";

export type DatosBienvenida = { nombres: string; apellidos: string; dni: string; telefono: string; clave: string };

/**
 * El link de bienvenida: guarda sus datos (solo esta vez) y su contraseña, lo deja usado y abre la sesión. Lo valida
 * la base de una vez (bienvenida_completar): el token es de un solo uso aunque se envíe dos veces a la vez.
 */
export async function completarBienvenida(token: string, d: DatosBienvenida): Promise<{ error: string } | { ok: true }> {
  const inv = await leerInvitacion(String(token));
  if (!inv) return { error: "Este link ya no sirve" };
  const nombres = String(d.nombres ?? "").trim().replace(/\s+/g, " ");
  const apellidos = String(d.apellidos ?? "").trim().replace(/\s+/g, " ");
  if (nombres.length < 2) return { error: "Ingresa tus nombres" };
  if (apellidos.length < 2) return { error: "Ingresa tus apellidos" };
  const dni = String(d.dni ?? "").trim();
  if (!/^(\d{8})?$/.test(dni)) return { error: "El DNI tiene 8 dígitos" };
  if (inv.rol === "GERENCIA" && !dni) return { error: "Ingresa tu DNI: va en los contratos que firmas" };
  const telefono = normalizarCelular(String(d.telefono ?? ""));
  if (telefono === null) return { error: "Celular no válido" };
  const invalida = contrasenaValida(String(d.clave ?? ""));
  if (invalida) return { error: invalida };

  // A nombre del propio usuario en la auditoría (x-actor).
  const { data: userId, error } = await createAdminClient(inv.userId).rpc("bienvenida_completar", {
    p_hash: hashToken(token),
    p_nombre: `${nombres} ${apellidos}`,
    p_dni: dni,
    p_telefono: telefono,
    p_clave: String(d.clave),
  });
  if (error || !userId) return { error: error?.message ?? "No se pudo guardar" };
  await registrarEvento({ tabla: "usuarios", accion: "BIENVENIDA", registro: userId, actor: userId });

  const supabase = await createClient();
  const abierta = await abrirSesion(supabase, userId);
  if ("error" in abierta) return { error: "Tus datos y tu contraseña quedaron guardados: entra con tu correo y tu contraseña" };
  await registrarEvento({ tabla: "sesion", accion: "LOGIN", registro: userId, actor: userId, detalle: { email: inv.email, metodo: "link" } });
  await marcarConocido(inv.email);
  await marcarDesbloqueo(userId);
  return { ok: true };
}
