// Empresa y obra compartidas entre Pagos y el Presupuesto de Tesorería: lo que se elige en una pantalla
// se lleva a la otra. Cuando una de las dos se muestra con otra empresa u obra, se guarda (cookie) y se
// pone en la vista guardada de la otra (prod1_vistas): el proxy, al entrar a esa sin filtros, ya la abre
// con las mismas. Se hace en el navegador, desde la pantalla que se muestra: en el proxy contarían también
// los prefetch de Next, que no siempre se distinguen y piden vistas viejas.
//
// Pagos: empresa = id o «todas»; obra = id o nada (todas las obras).
// Presupuesto: empresa = id o «*» (todas); obra = id o nada (la primera de la empresa). Si Pagos está en
// «todas las obras», el presupuesto conserva su propia obra.

import { COOKIE_VISTAS, claveBase, leerVistas } from "./vistas";

export const COOKIE_EMPRESA_OBRA = "prod1_empresa_obra";
export const MAX_EDAD_EMPRESA_OBRA = 60 * 60 * 24 * 365;

const PANTALLAS = { "/tesoreria": "pagos", "/tesoreria/consultas": "presupuesto" } as const;
type Pantalla = (typeof PANTALLAS)[keyof typeof PANTALLAS];
export type EmpresaObra = { empresa: string; obra: string | null };

const TODAS = "todas";
const TODOS = "*";
// Parámetros que no son de la vista: el avance del scroll infinito y los de las peticiones de Next.
const AJENOS = ["n", "_rsc"];

export const pantallaCompartida = (path: string): Pantalla | null => PANTALLAS[path as keyof typeof PANTALLAS] ?? null;

export function leerEmpresaObra(cookie: string | undefined): EmpresaObra | null {
  if (!cookie) return null;
  try {
    const v = JSON.parse(decodeURIComponent(cookie));
    return v && typeof v.empresa === "string" && v.empresa ? { empresa: v.empresa, obra: typeof v.obra === "string" && v.obra ? v.obra : null } : null;
  } catch {
    return null;
  }
}


/** Parámetros propios de la vista (sin los de paso). */
export function propios(params: URLSearchParams) {
  const p = new URLSearchParams(params);
  for (const a of AJENOS) p.delete(a);
  return p;
}

/** La empresa y obra que elige la URL, o null si no elige (la entrada de Pagos, una URL sin filtros). */
export function empresaObraDeUrl(pantalla: Pantalla, params: URLSearchParams): EmpresaObra | null {
  const e = params.get("empresa");
  const o = params.get("obra");
  const obra = o && o !== TODOS ? o : null;
  if (pantalla === "pagos") return e ? { empresa: e, obra } : null;
  if (!params.has("empresa") && !params.has("obra")) return null;
  return { empresa: e && e !== TODOS ? e : TODAS, obra };
}

/** `params` con la empresa y la obra compartidas, en el formato de cada pantalla. */
export function conEmpresaObra(pantalla: Pantalla, params: URLSearchParams, v: EmpresaObra): URLSearchParams {
  const p = new URLSearchParams(params);
  p.delete("n");
  if (pantalla === "pagos") {
    p.set("empresa", v.empresa);
    if (!p.get("area")) p.set("area", "log");
    if (v.obra) p.set("obra", v.obra);
    else p.delete("obra");
  } else {
    p.set("empresa", v.empresa === TODAS ? TODOS : v.empresa);
    if (v.obra) p.set("obra", v.obra);
  }
  return p;
}

const OTRA = { pagos: "/tesoreria/consultas", presupuesto: "/tesoreria" } as const;
// Parámetros base de cada vista, como los declara su RecordarFiltros (Pagos se recuerda por empresa).
const BASE: Record<string, string[]> = { "/tesoreria": ["empresa", "area"], "/tesoreria/consultas": [] };

/** Las vistas guardadas (JSON de la cookie) con la empresa y la obra elegidas puestas en la otra pantalla. */
export function vistasConEmpresaObra(cookie: string | undefined, desde: Pantalla, v: EmpresaObra): string {
  const vistas = leerVistas(cookie);
  const path = OTRA[desde];
  const otra = PANTALLAS[path];
  const base = BASE[path];
  const entrada = vistas[path] ?? { b: base, v: {} };
  let params = conEmpresaObra(otra, propios(new URLSearchParams(entrada.v[""] ?? "")), v);
  // En Pagos, lo último que se vio de esa empresa (otros filtros), si lo hay.
  const k = claveBase(params, base);
  if (k && entrada.v[k]) params = conEmpresaObra(otra, propios(new URLSearchParams(entrada.v[k])), v);
  const vista = params.toString();
  entrada.b = base;
  entrada.v[""] = vista;
  if (k) entrada.v[k] = vista;
  vistas[path] = entrada;
  return JSON.stringify(vistas);
}

const leerCookie = (nombre: string) => document.cookie.match(new RegExp(`(?:^|; )${nombre}=([^;]*)`))?.[1];
const escribirCookie = (nombre: string, valor: string) => {
  document.cookie = `${nombre}=${encodeURIComponent(valor)}; path=/; max-age=${MAX_EDAD_EMPRESA_OBRA}; samesite=lax`;
};

/** Desde el navegador: si `path` (Pagos o Presupuesto) muestra otra empresa u obra, la comparte con la otra. */
export function compartirEmpresaObra(path: string, params: URLSearchParams) {
  const pantalla = pantallaCompartida(path);
  const elegida = pantalla && empresaObraDeUrl(pantalla, params);
  if (!pantalla || !elegida) return;
  try {
    const compartida = leerEmpresaObra(leerCookie(COOKIE_EMPRESA_OBRA));
    if (compartida?.empresa === elegida.empresa && compartida.obra === elegida.obra) return;
    escribirCookie(COOKIE_EMPRESA_OBRA, JSON.stringify(elegida));
    escribirCookie(COOKIE_VISTAS, vistasConEmpresaObra(leerCookie(COOKIE_VISTAS), pantalla, elegida));
  } catch {
    // Sin cookies: cada pantalla recuerda solo lo suyo.
  }
}
