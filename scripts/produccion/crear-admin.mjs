// Crea el primer Admin de un proyecto de Supabase (producción): cuenta confirmada, perfil ADMIN y una
// contraseña al azar que se muestra UNA vez. Los demás usuarios los crea él desde la app (Usuarios).
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SECRET_KEY=... \
//     node scripts/produccion/crear-admin.mjs correo@empresa.com "Nombre Apellido"
//
// No lee .env.local a propósito: las claves de producción se pasan solo para esta llamada.
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [email, nombre] = process.argv.slice(2);
// Sin comillas sobrantes (si se copiaron de un .env).
const sinComillas = (v) => v?.trim().replace(/^["']|["']$/g, "");
const url = sinComillas(process.env.SUPABASE_URL);
const clave = sinComillas(process.env.SUPABASE_SECRET_KEY);
if (!email || !nombre || !url || !clave) {
  console.error('Uso: SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/produccion/crear-admin.mjs correo "Nombre"');
  process.exit(1);
}

// Sin caracteres que se confunden (0/O, 1/l/I), como las contraseñas temporales de la app.
const LETRAS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const contrasena = Array.from(crypto.randomBytes(14), (n) => LETRAS[n % LETRAS.length]).join("");

const db = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.auth.admin.createUser({
  email: email.trim().toLowerCase(),
  password: contrasena,
  email_confirm: true,
  app_metadata: { rol: "ADMIN", nombre },
});
if (error) {
  console.error(`No se pudo crear la cuenta: ${error.message}`);
  process.exit(1);
}
const { error: e2 } = await db.from("perfiles").insert({ user_id: data.user.id, nombre, rol: "ADMIN" });
if (e2) {
  await db.auth.admin.deleteUser(data.user.id);
  console.error(`No se pudo crear el perfil (se deshizo la cuenta): ${e2.message}`);
  process.exit(1);
}
console.log(`Admin creado: ${email} (${nombre})`);
console.log(`Contraseña temporal (cámbiala al entrar, en tu menú › Cambiar contraseña): ${contrasena}`);
