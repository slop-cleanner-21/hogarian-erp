import { opcionesParaDesbloquear, usuarioDeSesion } from "@/lib/desbloqueo";

// Opciones para desbloquear con la huella. { opciones: null }: no hay huella que pedir (ya quedó desbloqueado).
// 409: tiene huellas, pero ninguna de este dominio (queda «Usar contraseña»). 400: origen ajeno.
export async function POST() {
  const sesion = await usuarioDeSesion();
  if (!sesion) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const sinCache = { "Cache-Control": "no-store" };
  try {
    const opciones = await opcionesParaDesbloquear(sesion);
    if (opciones && "sinHuellaAqui" in opciones) return Response.json({ error: "Sin huella en este dominio" }, { status: 409, headers: sinCache });
    return Response.json({ opciones }, { headers: sinCache });
  } catch {
    return Response.json({ error: "No permitido" }, { status: 400, headers: sinCache });
  }
}
