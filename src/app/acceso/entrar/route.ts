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
  // Redirecciones relativas: con `next start`, req.url dice localhost aunque se entre por la IP de la red, y
  // form-action 'self' bloquea el salto a otro origen.
  if (!esperada || !igual(clave, esperada)) return new Response(null, { status: 303, headers: { Location: "/acceso?error=1" } });
  // Secure solo por HTTPS: por http://<IP de la red> el navegador no guardaría la cookie (solo exceptúa localhost).
  const https = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const cookie = [
    `${COOKIE_ACCESO}=${await firmaAcceso()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 7}`,
    ...(https ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": cookie } });
}
