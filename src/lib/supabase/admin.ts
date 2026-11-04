import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Cliente con la clave secreta de Supabase: salta la RLS y usa la API de administración de cuentas.
 * Solo en el servidor y después de comprobar el rol de quien llama (p. ej. `requireSesion(["ADMIN"])`).
 * `actor`: el usuario que hace la acción; la auditoría lo registra como autor (sin token no hay `auth.uid()`).
 */
export function createAdminClient(actor?: string) {
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!clave) throw new Error("Falta SUPABASE_SECRET_KEY");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(actor ? { global: { headers: { "x-actor": actor } } } : {}),
  });
}
