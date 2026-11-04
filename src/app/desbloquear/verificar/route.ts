import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { usuarioDeSesion, verificarDesbloqueo } from "@/lib/desbloqueo";

// Verifica la huella y, si es del usuario de la sesión, desbloquea (la cookie la pone el servidor).
export async function POST(req: Request) {
  const uid = await usuarioDeSesion();
  if (!uid) return Response.json({ ok: false }, { status: 401 });
  const respuesta = (await req.json().catch(() => null)) as AuthenticationResponseJSON | null;
  if (!respuesta?.id) return Response.json({ ok: false }, { status: 400 });
  return Response.json({ ok: await verificarDesbloqueo(uid, respuesta) }, { headers: { "Cache-Control": "no-store" } });
}
