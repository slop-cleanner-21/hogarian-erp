import { timingSafeEqual } from "node:crypto";
import { COOKIE_ACCESO, accesoActivo, firmaAcceso } from "@/lib/acceso";

// La contraseña de la demo (local o túnel). Una ruta, no una server action: sin esta contraseña el proxy no deja
// pasar ninguna server action (se pueden llamar desde cualquier ruta, también desde esta pública).

const igual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function POST(req: Request) {
  if (!accesoActivo()) return new Response(null, { status: 404 });
  const clave = String((await req.formData().catch(() => null))?.get("clave") ?? "");
  const esperada = process.env.DEMO_ACCESO ?? "";
  const destino = (ruta: string) => new URL(ruta, req.url);
  if (!esperada || !igual(clave, esperada)) return Response.redirect(destino("/acceso?error=1"), 303);
  const res = Response.redirect(destino("/login"), 303);
  const cookie = [
    `${COOKIE_ACCESO}=${await firmaAcceso()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 7}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  // Response.redirect deja los headers inmutables: se arma una respuesta nueva con la cookie.
  return new Response(null, { status: 303, headers: { Location: res.headers.get("Location")!, "Set-Cookie": cookie } });
}
