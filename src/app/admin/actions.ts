"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES_PROD1 } from "@/lib/prod1";
import { registrarEvento } from "@/lib/auditoria";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";
import type { Rol } from "@/lib/types";
import { crearLink, invalidarLinks } from "@/lib/bienvenida";
import { contrasenaAlAzar, contrasenaValida, MIN_CONTRASENA, normalizarCelular } from "@/lib/usuarios";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): Result<never> => ({ ok: false, error });

// Solo el Admin. requireSesion deja pasar al Admin con cualquier lista; con ["ADMIN"] nadie más entra.
async function admin() {
  const sesion = await requireSesionVigente(["ADMIN"]);
  if (sesion.rol !== "ADMIN") throw new Error("Solo el Administrador gestiona usuarios");
  // Los cambios en perfiles quedan en la auditoría a nombre del Admin (x-actor).
  return { sesion, db: createAdminClient(sesion.userId) };
}

// Un desactivado queda baneado (no entra ni renueva su sesión; la base deja de darle datos al instante).
const BANEO = "876000h";

const Rol_ = z.enum(ROLES_PROD1 as [Rol, ...Rol[]], { error: "Elige el rol" });
const Datos = z.object({
  nombres: z.string().trim().min(2, "Ingresa los nombres").max(80),
  /** Opcionales al crear la cuenta: con el link de bienvenida los completa el usuario. */
  apellidos: z.string().trim().max(80).default(""),
  email: z.email({ error: "Correo no válido" }).trim().toLowerCase(),
  /** DNI: obligatorio en Gerencia (va con su firma en los contratos de las OS). */
  dni: z
    .string()
    .trim()
    .regex(/^(\d{8})?$/, "El DNI tiene 8 dígitos")
    .default(""),
  /** Celular (para pasarle el link o la contraseña por WhatsApp): opcional. */
  telefono: z
    .string()
    .default("")
    .transform((t, ctx) => {
      const n = normalizarCelular(t);
      if (n === null) ctx.addIssue({ code: "custom", message: "Celular no válido" });
      return n ?? "";
    }),
});
/** El nombre completo (como lo arma la base). */
const completo = (d: { nombres: string; apellidos: string }) => [d.nombres, d.apellidos].map((x) => x.trim()).filter(Boolean).join(" ");
const conDni = (d: { rol: string; dni: string }) => d.rol !== "GERENCIA" || d.dni !== "";
const SIN_DNI = "Ingresa el DNI: va en los contratos que firma Gerencia";

/** DNI y celular van aparte del perfil (perfil_privado): solo los lee el servidor. */
async function guardarPrivado(db: ReturnType<typeof createAdminClient>, id: string, dni: string, telefono: string) {
  const { error } = await db.from("perfil_privado").upsert({ user_id: id, dni: dni || null, telefono: telefono || null }, { onConflict: "user_id" });
  return error;
}

/** Cómo se le da el acceso: un link de un solo uso (completa sus datos y crea su contraseña) o una contraseña temporal. */
export type Acceso = { link: { url: string; vence: string } } | { contrasena: string };

function mensaje(e: { message: string; code?: string } | null) {
  if (!e) return "No se pudo guardar";
  if (e.code === "email_exists" || /already (been )?registered/i.test(e.message)) return "Ya hay una cuenta con ese correo";
  if (e.code === "weak_password" || /password/i.test(e.message)) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres, con letras y números`;
  return e.message;
}

const Crear = Datos.extend({
  rol: Rol_,
  acceso: z.enum(["link", "contrasena"]),
  contrasena: z.string().default(""),
})
  .refine(conDni, { message: SIN_DNI })
  .superRefine((d, ctx) => {
    const error = d.acceso === "contrasena" ? contrasenaValida(d.contrasena) : null;
    if (error) ctx.addIssue({ code: "custom", message: error });
  });

export async function crearUsuario(input: z.input<typeof Crear>): Promise<Result<{ id: string; acceso: Acceso }>> {
  const p = Crear.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const { sesion, db } = await admin();
  // La contraseña no va a Supabase Auth (ahí queda una al azar): la guarda la base (credenciales).
  const { data, error } = await db.auth.admin.createUser({
    email: p.data.email,
    email_confirm: true,
    app_metadata: { rol: p.data.rol, nombre: completo(p.data) },
  });
  if (error || !data.user) return fail(mensaje(error));
  // `nombre` (el completo) lo arma la base con nombres y apellidos.
  const { error: e2 } = await db
    .from("perfiles")
    .insert({ user_id: data.user.id, nombre: completo(p.data), nombres: p.data.nombres, apellidos: p.data.apellidos || null, rol: p.data.rol });
  // Con link, sin contraseña hasta que lo use (no puede entrar antes).
  const e4 = e2 || p.data.acceso === "link" ? null : (await db.rpc("fijar_contrasena", { p_user: data.user.id, p_clave: p.data.contrasena })).error;
  if (e2 || e4) {
    // Sin perfil o sin contraseña la cuenta no sirve: se deshace.
    await db.auth.admin.deleteUser(data.user.id);
    return fail((e2 ?? e4)!.message);
  }
  if (p.data.dni || p.data.telefono) {
    const e3 = await guardarPrivado(db, data.user.id, p.data.dni, p.data.telefono);
    if (e3) return fail(e3.message);
  }
  let acceso: Acceso = { contrasena: p.data.contrasena };
  if (p.data.acceso === "link") {
    const l = await crearLink(data.user.id, sesion.userId);
    if ("error" in l) return fail(l.error);
    acceso = { link: l };
  }
  await registrarEvento({
    tabla: "usuarios",
    accion: "CREAR_USUARIO",
    registro: data.user.id,
    actor: sesion.userId,
    detalle: { email: p.data.email, nombre: completo(p.data), rol: p.data.rol, acceso: p.data.acceso },
  });
  revalidatePath("/admin");
  return { ok: true, data: { id: data.user.id, acceso } };
}

const Editar = Datos.extend({ id: z.guid(), rol: z.string() }).refine(conDni, { message: SIN_DNI });

/** Nombre, correo y rol. El rol solo puede pasar a uno de prod 1 (o quedarse como estaba). */
export async function editarUsuario(input: z.input<typeof Editar>): Promise<Result> {
  const p = Editar.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const { sesion, db } = await admin();
  const { data: actual } = await db.from("perfiles").select("rol, nombre").eq("user_id", p.data.id).maybeSingle();
  if (!actual) return fail("El usuario no existe");
  const rol = p.data.rol as Rol;
  if (rol !== actual.rol && !ROLES_PROD1.includes(rol)) return fail("Elige el rol");
  if (p.data.id === sesion.userId && rol !== "ADMIN") return fail("No puedes quitarte el rol de Administrador");

  const { data: u } = await db.auth.admin.getUserById(p.data.id);
  if (u.user && u.user.email !== p.data.email) {
    const { error } = await db.auth.admin.updateUserById(p.data.id, { email: p.data.email, email_confirm: true });
    if (error) return fail(mensaje(error));
  }
  // El perfil pasa el rol y el nombre al token (trigger perfiles_a_token); en la base rigen al instante.
  const { error } = await db.from("perfiles").update({ nombres: p.data.nombres, apellidos: p.data.apellidos || null, rol }).eq("user_id", p.data.id);
  if (error) return fail(error.message);
  const e2 = await guardarPrivado(db, p.data.id, p.data.dni, p.data.telefono);
  if (e2) return fail(e2.message);
  await registrarEvento({
    tabla: "usuarios",
    accion: "EDITAR_USUARIO",
    registro: p.data.id,
    actor: sesion.userId,
    detalle: {
      antes: { email: u.user?.email ?? null, nombre: actual.nombre, rol: actual.rol },
      despues: { email: p.data.email, nombre: completo(p.data), rol },
    },
  });
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

/** Contraseña temporal nueva; se muestra una vez al Admin para que se la pase al usuario. */
export async function restablecerContrasena(id: string): Promise<Result<string>> {
  if (!z.guid().safeParse(id).success) return fail("Usuario no válido");
  const { sesion, db } = await admin();
  const contrasena = contrasenaAlAzar();
  // En la base (credenciales), no en Supabase Auth; cierra todas sus sesiones. Sus links sin usar dejan de servir.
  const { error } = await db.rpc("fijar_contrasena", { p_user: id, p_clave: contrasena });
  if (error) return fail(error.message);
  await invalidarLinks(id, sesion.userId);
  // Sin la contraseña: solo que se restableció.
  await registrarEvento({ tabla: "usuarios", accion: "RESTABLECER_CONTRASENA", registro: id, actor: sesion.userId });
  return { ok: true, data: contrasena };
}

/** Un link de acceso nuevo para la cuenta (de un solo uso, 7 días; el anterior sin usar deja de servir). */
export async function generarLink(id: string): Promise<Result<{ url: string; vence: string }>> {
  if (!z.guid().safeParse(id).success) return fail("Usuario no válido");
  const { sesion } = await admin();
  const l = await crearLink(id, sesion.userId);
  if ("error" in l) return fail(l.error);
  await registrarEvento({ tabla: "usuarios", accion: "GENERAR_LINK", registro: id, actor: sesion.userId });
  return { ok: true, data: l };
}

export async function cambiarActivo(id: string, activo: boolean): Promise<Result> {
  if (!z.guid().safeParse(id).success) return fail("Usuario no válido");
  const { sesion, db } = await admin();
  if (id === sesion.userId) return fail("No puedes desactivar ni reactivar tu propia cuenta");
  const { error } = await db.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : BANEO });
  if (error) return fail(mensaje(error));
  await registrarEvento({ tabla: "usuarios", accion: activo ? "REACTIVAR" : "DESACTIVAR", registro: id, actor: sesion.userId });
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}
