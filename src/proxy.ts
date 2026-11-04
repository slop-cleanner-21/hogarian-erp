import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ACCESO, RUTA_ACCESO, accesoActivo, firmaAcceso } from "@/lib/acceso";
import { rolEnProd1 } from "@/lib/prod1";
import { COOKIE_SESION } from "@/lib/supabase/config";
import type { Rol } from "@/lib/types";
import { COOKIE_VISTAS, vistaGuardada } from "@/lib/vistas";

const PUBLICAS = ["/login", "/cotizar", RUTA_ACCESO];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Contraseña de la demo: antes que la sesión. Los links de cotización (proveedores) quedan libres.
  if (accesoActivo() && !path.startsWith("/cotizar")) {
    const ok = request.cookies.get(COOKIE_ACCESO)?.value === (await firmaAcceso());
    if (path.startsWith(RUTA_ACCESO)) {
      return ok ? NextResponse.redirect(new URL("/login", request.url)) : NextResponse.next();
    }
    if (!ok) return NextResponse.redirect(new URL(RUTA_ACCESO, request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: COOKIE_SESION,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Verifica el JWT localmente y lo refresca si venció (getUser haría un viaje al servidor de auth).
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !PUBLICAS.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Prod 1: los roles sin módulo (Contabilidad, Residente, Ing. de Operaciones, RRHH) solo ven «Sin acceso».
  const rol = (data?.claims?.app_metadata as { rol?: Rol } | undefined)?.rol;
  if (rol && !rolEnProd1(rol) && path !== "/sin-acceso" && !PUBLICAS.some((p) => path.startsWith(p))) {
    const redireccion = NextResponse.redirect(new URL("/sin-acceso", request.url));
    response.cookies.getAll().forEach((c) => redireccion.cookies.set(c));
    return redireccion;
  }

  // Lista sin filtros: se abre directamente con la última vista guardada (sin pintarla vacía y saltar).
  if (request.method === "GET") {
    const destino = vistaGuardada(request.cookies.get(COOKIE_VISTAS)?.value, path, request.nextUrl.searchParams);
    if (destino) {
      const redireccion = NextResponse.redirect(new URL(destino, request.url));
      // Conserva las cookies de sesión que haya refrescado Supabase.
      response.cookies.getAll().forEach((c) => redireccion.cookies.set(c));
      return redireccion;
    }
  }
  return response;
}

export const config = {
  // Recursos públicos (íconos, manifiesto) y el reenvío a Supabase (/sb, que valida su propia sesión)
  // no pasan por aquí.
  matcher: ["/((?!_next/static|_next/image|sb/|favicon.ico|manifest.webmanifest|sw\\.js|apple-icon|icono/|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
