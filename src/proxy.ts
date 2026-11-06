import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ACCESO, RUTA_ACCESO, accesoActivo, firmaAcceso } from "@/lib/acceso";
import { RUTAS_LIBRES } from "@/lib/bloqueo";
import {
  COOKIE_DESBLOQUEO,
  COOKIE_DISPOSITIVO,
  COOKIE_LIBRE,
  RENOVAR_MS,
  VENTANA_MS,
  desbloqueoHasta,
  desbloqueoPara,
  leerFirmado,
  librePara,
  libreVigente,
  opcionesDesbloqueo,
  opcionesLibre,
} from "@/lib/bloqueo-servidor";
import { rolEnProd1 } from "@/lib/prod1";
import { COOKIE_SESION } from "@/lib/supabase/config";
import type { Rol } from "@/lib/types";
import { COOKIE_VISTAS, vistaGuardada } from "@/lib/vistas";

// /bienvenida: el link de un solo uso para entrar la primera vez (completa sus datos y crea su contraseña).
const PUBLICAS = ["/login", "/cotizar", "/bienvenida", RUTA_ACCESO];

/** Rol de un JWT, sin verificarlo (solo para rechazar; Supabase verifica el resto). */
function rolDelJwt(jwt: string): string | null {
  try {
    const p = jwt.split(".")[1];
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Reenvío a Supabase (/sb: local o por túnel; en producción no existe). Con el túnel abierto, /sb publicaba la
 * base entera, y las claves locales de la CLI son las de su documentación. Exige la contraseña de la demo y la
 * clave pública, y nunca deja pasar la clave secreta, un token service_role ni la administración de Auth.
 */
async function guardarSb(request: NextRequest) {
  const denegar = () => NextResponse.json({ message: "No permitido" }, { status: 403 });
  if (accesoActivo() && request.cookies.get(COOKIE_ACCESO)?.value !== (await firmaAcceso())) return denegar();
  if (request.nextUrl.pathname.startsWith("/sb/auth/v1/admin")) return denegar();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  for (const clave of [request.headers.get("apikey"), request.nextUrl.searchParams.get("apikey")]) {
    if (clave && clave !== anon) return denegar();
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer && bearer !== anon && (bearer.startsWith("sb_secret_") || rolDelJwt(bearer) !== "authenticated")) return denegar();
  // Supabase se autentica con su clave y el token, no con cookies. En localhost llegan también las del MVP, y por encima
  // de 8 KB su puerta de entrada responde «Bad request» a todo (descargas, campana, avisos en vivo).
  const cabeceras = new Headers(request.headers);
  cabeceras.delete("cookie");
  const res = NextResponse.next({ request: { headers: cabeceras } });
  // Archivos de Storage servidos con el origen de la app: sin adivinar el tipo y, salvo los PDF (el visor del
  // navegador no los mostraría), en sandbox: un XML o HTML subido por un interno no corre con la sesión de la app.
  // (headers() de next.config no llega a las respuestas reescritas.)
  if (request.nextUrl.pathname.startsWith("/sb/storage/")) {
    res.headers.set("X-Content-Type-Options", "nosniff");
    if (!/\.pdf$/i.test(request.nextUrl.pathname)) res.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/sb/")) return guardarSb(request);

  // Sin la contraseña de la demo, ningún POST (las server actions se pueden llamar desde cualquier ruta, también
  // desde /cotizar, la única pública; con o sin JavaScript: sin él van como formulario, sin la cabecera
  // Next-Action). Solo las dos rutas públicas: el envío del proveedor y la contraseña de la demo.
  if (
    accesoActivo() &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    path !== "/acceso/entrar" &&
    !/^\/cotizar\/[0-9a-f-]{36}\/enviar$/i.test(path) &&
    request.cookies.get(COOKIE_ACCESO)?.value !== (await firmaAcceso())
  ) {
    return NextResponse.json({ message: "No permitido" }, { status: 403 });
  }

  // Contraseña de la demo: antes que la sesión. Los links de cotización (proveedores) quedan libres.
  if (accesoActivo() && !path.startsWith("/cotizar")) {
    const ok = request.cookies.get(COOKIE_ACCESO)?.value === (await firmaAcceso());
    if (path.startsWith(RUTA_ACCESO)) {
      return ok ? NextResponse.redirect(new URL("/login", request.url)) : NextResponse.next();
    }
    if (!ok) return NextResponse.redirect(new URL(RUTA_ACCESO, request.url));
  }

  // La ruta pedida, para volver a ella al cambiar de rol (requireSesion). La pone siempre el proxy: no se puede inventar.
  request.headers.set("x-prod1-ruta", `${path}${request.nextUrl.search}`);
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

  // Bloqueo con huella, hecho cumplir aquí y en la base (no solo en el navegador: ni desactivar JavaScript ni borrar
  // cookies se lo salta). Una sesión con la huella activada, sin «desbloqueado» vigente, no recibe ninguna pantalla (y
  // la base no le da datos). El «desbloqueado» se renueva con los pedidos (la app manda un latido cada minuto mientras
  // está a la vista) y vence a los 3 minutos sin actividad. Lo resuelve la base (bloqueo_estado, que además lo renueva);
  // las cookies firmadas solo evitan preguntarle en cada pedido: un «desbloqueado» renovado hace menos de 45 s, o
  // «sin bloqueo» de esta misma sesión (10 min).
  const uid = data?.claims?.sub;
  const sid = typeof data?.claims?.session_id === "string" ? data.claims.session_id : null;
  if (uid && sid && !RUTAS_LIBRES.some((r) => path === r || path.startsWith(`${r}/`))) {
    const hasta = await desbloqueoHasta(request.cookies.get(COOKIE_DESBLOQUEO)?.value, uid);
    const reciente = hasta !== null && hasta - Date.now() > VENTANA_MS - RENOVAR_MS;
    if (!reciente && !(await libreVigente(request.cookies.get(COOKIE_LIBRE)?.value, sid))) {
      let { data: estado } = await supabase.rpc("bloqueo_estado");
      // Una sesión abierta antes de que la base llevara el bloqueo, en un dispositivo con la huella: queda bloqueada.
      if (estado === "libre" && (await leerFirmado(request.cookies.get(COOKIE_DISPOSITIVO)?.value)) === uid) {
        await supabase.rpc("bloqueo_activar", { p_abierta: false });
        estado = "bloqueada";
      }
      if (estado === "abierta") response.cookies.set(COOKIE_DESBLOQUEO, await desbloqueoPara(uid), opcionesDesbloqueo());
      else if (estado === "libre") response.cookies.set(COOKIE_LIBRE, await librePara(sid), opcionesLibre());
      else if (estado === "bloqueada") {
        if (request.method !== "GET" || request.headers.has("next-action")) {
          return NextResponse.json({ message: "Bloqueado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        const destino = new URL("/desbloquear", request.url);
        destino.searchParams.set("volver", `${path}${request.nextUrl.search}`);
        const redireccion = NextResponse.redirect(destino);
        response.cookies.getAll().forEach((c) => redireccion.cookies.set(c));
        redireccion.cookies.delete(COOKIE_DESBLOQUEO);
        return redireccion;
      }
    }
  }

  // Lista sin filtros: se abre directamente con la última vista guardada (sin pintarla vacía y saltar).
  if (request.method === "GET") {
    const destino = vistaGuardada(request.cookies.get(COOKIE_VISTAS)?.value, path, request.nextUrl.searchParams, request.headers.get("referer"));
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
  // Recursos públicos (íconos, manifiesto) no pasan por aquí. El reenvío a Supabase sí (guardarSb), también sus
  // imágenes.
  matcher: ["/sb/:path*", "/((?!_next/static|_next/image|sb/|favicon.ico|manifest.webmanifest|sw\\.js|apple-icon|icono/|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
