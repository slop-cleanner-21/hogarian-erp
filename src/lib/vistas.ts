// Última vista (filtros de la URL) de cada lista, en una cookie para que el servidor la restaure antes de
// pintar: al volver a una lista sin filtros, el proxy redirige a la última vista guardada en vez de
// mostrar la lista sin filtrar y saltar después. Solo guarda parámetros de filtro (ids, texto buscado).

export const COOKIE_VISTAS = "prod1_vistas";
const MAX_EDAD = 60 * 60 * 24 * 365;

/** Por ruta: los parámetros base de la vista y, por cada combinación de base (y "" = la última), la URL completa. */
type Vistas = Record<string, { b: string[]; v: Record<string, string> }>;

// Parámetros que nunca cuentan: el avance del scroll infinito y los de las peticiones internas de Next.
const AJENOS = ["n", "_rsc"];

export const claveBase = (params: URLSearchParams, base: string[]) =>
  base
    .filter((b) => params.get(b))
    .sort()
    .map((b) => `${b}=${params.get(b)}`)
    .join("&");

export function leerVistas(cookie: string | undefined): Vistas {
  if (!cookie) return {};
  try {
    const v = JSON.parse(decodeURIComponent(cookie));
    return v && typeof v === "object" ? (v as Vistas) : {};
  } catch {
    return {};
  }
}

/**
 * Adónde llevar una petición a `path` con `params`: la vista guardada si llega sin filtros (sin nada, o
 * solo con su base). null si no hay que redirigir. `anterior` es la pantalla desde la que se pide: si es esta misma
 * vista, el usuario está cambiando sus filtros (p. ej. vació el buscador) y no se restaura; la cookie todavía tiene
 * lo de antes, y lo borrado volvía a aparecer.
 */
export function vistaGuardada(cookie: string | undefined, path: string, params: URLSearchParams, anterior?: string | null): string | null {
  const entrada = leerVistas(cookie)[path];
  if (!entrada) return null;
  const propios = new URLSearchParams(params);
  for (const a of AJENOS) propios.delete(a);
  if (anterior) {
    try {
      const a = new URL(anterior);
      if (a.pathname === path && claveBase(a.searchParams, entrada.b) === claveBase(propios, entrada.b)) return null;
    } catch {}
  }
  const nombres = [...new Set(propios.keys())];
  if (nombres.some((n) => !entrada.b.includes(n))) return null; // ya trae filtros
  // Un valor vacío en la base (p. ej. «?area=») es elegir de nuevo: no se restaura.
  if (nombres.some((n) => !propios.get(n))) return null;
  const destino = entrada.v[nombres.length ? claveBase(propios, entrada.b) : ""];
  if (!destino) return null;
  const actual = new URLSearchParams(propios);
  actual.sort();
  const nuevo = new URLSearchParams(destino);
  nuevo.sort();
  return nuevo.toString() === actual.toString() ? null : `${path}?${destino}`;
}

/** Guarda (o borra, si `filtros` es null) la vista de `path` desde el navegador. */
export function guardarVista(path: string, base: string[], completa: URLSearchParams, filtros: boolean) {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_VISTAS}=([^;]*)`));
    const vistas = leerVistas(m?.[1]);
    const entrada = vistas[path] ?? { b: base, v: {} };
    entrada.b = base;
    const limpia = new URLSearchParams(completa);
    for (const a of AJENOS) limpia.delete(a);
    const k = claveBase(limpia, base);
    if (filtros) {
      entrada.v[k] = limpia.toString();
      entrada.v[""] = limpia.toString();
    } else {
      delete entrada.v[k];
      // Sin filtros, la última vista es solo la base (o nada).
      if (k) entrada.v[""] = k;
      else delete entrada.v[""];
    }
    vistas[path] = entrada;
    document.cookie = `${COOKIE_VISTAS}=${encodeURIComponent(JSON.stringify(vistas))}; path=/; max-age=${MAX_EDAD}; samesite=lax`;
  } catch {
    // Sin cookies: se restaura en el navegador como antes.
  }
}

/**
 * En el navegador: la URL final de un enlace del menú (su vista guardada, si la hay). Así se navega directo,
 * sin la redirección del proxy, que costaba un viaje entero en datos móviles (el proxy queda de respaldo).
 */
export function destinoDe(href: string): string {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_VISTAS}=([^;]*)`));
    const [ruta, query = ""] = href.split("?");
    return vistaGuardada(m?.[1], ruta, new URLSearchParams(query)) ?? href;
  } catch {
    return href;
  }
}
