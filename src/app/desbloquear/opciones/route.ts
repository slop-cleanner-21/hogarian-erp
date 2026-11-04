import { opcionesParaDesbloquear, usuarioDeSesion } from "@/lib/desbloqueo";

// Opciones para desbloquear con la huella. { opciones: null }: no hay huella que pedir (ya quedó desbloqueado).
export async function POST() {
  const uid = await usuarioDeSesion();
  if (!uid) return Response.json({ error: "Sin sesión" }, { status: 401 });
  return Response.json({ opciones: await opcionesParaDesbloquear(uid) }, { headers: { "Cache-Control": "no-store" } });
}
