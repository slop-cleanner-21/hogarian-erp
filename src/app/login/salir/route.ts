import { registrarEvento } from "@/lib/auditoria";
import { quitarDesbloqueo } from "@/lib/bloqueo-cookies";
import { createClient } from "@/lib/supabase/server";

// Cerrar sesión: una ruta (formulario POST), no una server action, para que funcione también con la pantalla
// bloqueada (el proxy no deja pasar server actions sin «desbloqueado») y sin JavaScript.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub ?? null;
  // Solo esta sesión (la de este dispositivo): las de sus otros dispositivos siguen abiertas.
  await supabase.auth.signOut({ scope: "local" });
  // Sin sesión no hay nada que desbloquear (la marca de la huella del dispositivo queda).
  await quitarDesbloqueo();
  if (id) await registrarEvento({ tabla: "sesion", accion: "LOGOUT", registro: id, actor: id, detalle: { email: data?.claims?.email ?? null } });
  // (Una respuesta propia: la de Response.redirect tiene las cabeceras inmutables y Next le agrega las cookies.)
  return new Response(null, { status: 303, headers: { Location: new URL("/login", req.url).toString() } });
}
