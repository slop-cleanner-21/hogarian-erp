/** Valores centinela para filtros de selección. */
export const TODOS = "*";
export const SIN_TIPO = "-";

/** Tamaño de página de listas; `?n=` amplía el límite con "Ver más". */
export const PASO = 100;
export function limite(sp: Record<string, string | string[] | undefined>) {
  const n = Number(sp.n);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5000) : PASO;
}

/** Valor de un filtro de la URL (`null` si no se filtra). */
export function filtro(sp: Record<string, string | string[] | undefined>, param: string) {
  const v = sp[param];
  return typeof v === "string" && v !== TODOS && v !== "" ? v : null;
}

/**
 * Orden desde `?orden=columna.asc|desc`, restringido a las columnas permitidas.
 * Devuelve la columna, la dirección y la clave para marcar la opción elegida.
 */
export function ordenDe<C extends string>(
  sp: Record<string, string | string[] | undefined>,
  columnas: readonly C[],
  porDefecto: `${C}.${"asc" | "desc"}`,
) {
  const raw = typeof sp.orden === "string" ? sp.orden : porDefecto;
  const [col, dir] = raw.split(".") as [C, string];
  const valido = columnas.includes(col) && (dir === "asc" || dir === "desc");
  const [c, d] = (valido ? raw : porDefecto).split(".") as [C, "asc" | "desc"];
  return { columna: c, asc: d === "asc", clave: `${c}.${d}` };
}

/** Filtro de fecha de las bandejas (valor del parámetro `fecha`). */
export const FECHAS = [
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "mes", label: "Este mes" },
  { value: "mesant", label: "Mes anterior" },
];

/** Rango personalizado en la URL: `AAAA-MM-DD_AAAA-MM-DD` (ambos días incluidos). */
export const RANGO_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

/** Etiqueta corta de un rango personalizado: "01/10 – 15/10" (con año si no es el actual). */
export function etiquetaRango(v: string) {
  const m = RANGO_RE.exec(v);
  if (!m) return v;
  const anio = String(new Date().getFullYear());
  const f = (d: string) => (d.startsWith(anio) ? d.slice(5).split("-").reverse().join("/") : d.split("-").reverse().join("/"));
  return m[1] === m[2] ? f(m[1]) : `${f(m[1])} – ${f(m[2])}`;
}

/** Rango [desde, hasta) en fechas ISO de Lima para un valor de FECHAS o un rango personalizado. */
export function desdeFecha(f: string | null): [string, string] | null {
  if (!f) return null;
  const r = RANGO_RE.exec(f);
  if (r) {
    const fin = new Date(`${r[2]}T00:00:00Z`);
    fin.setUTCDate(fin.getUTCDate() + 1);
    return [r[1], fin.toISOString().slice(0, 10)];
  }
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
  if (f === "7d") return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7)), iso(manana)];
  if (f === "30d") return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 30)), iso(manana)];
  if (f === "mes") return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1))];
  if (f === "mesant") return [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1))];
  return null;
}

/** Rangos del filtro de monto (Pagos y Logística), con su [desde, hasta). */
export const MONTOS = [
  { value: "bajo", label: "Menos de 1,000" },
  { value: "medio", label: "De 1,000 a 10,000" },
  { value: "alto", label: "Más de 10,000" },
];
export const RANGOS_MONTO: Record<string, [number, number | null]> = {
  bajo: [0, 1000],
  medio: [1000, 10000],
  alto: [10000, null],
};
