// Diseño de las listas (Pagos de Tesorería, órdenes de Logística) y del detalle de una orden, y si los
// filtros quedan fijos arriba. Van en cookies por pantalla para que el servidor pinte ya lo elegido.

import { fecha } from "./format";

/** Diseños de la lista de Pagos (Tesorería). */
export const DISENOS = [
  { value: "lista", label: "Lista" },
  { value: "compacta", label: "Compacta" },
  { value: "tarjetas", label: "Tarjetas" },
  { value: "tabla", label: "Tabla" },
  { value: "mosaico", label: "Mosaico" },
  { value: "obra", label: "Por obra" },
  { value: "proveedor", label: "Por proveedor" },
  { value: "fecha", label: "Por fecha" },
  { value: "etapa", label: "Por etapa" },
  { value: "empresa", label: "Por empresa" },
  { value: "monto", label: "Por monto" },
] as const;
/** Logística: sin «Por empresa» (a Logística no le sirve la empresa). */
export const DISENOS_LOGISTICA = DISENOS.filter((d) => d.value !== "empresa");
export type Diseno = (typeof DISENOS)[number]["value"];

/** Diseños de los ítems en el detalle de una orden (Logística y pago de Tesorería). */
export const DISENOS_ITEMS = [
  { value: "lista", label: "Lista" },
  { value: "compacta", label: "Compacta" },
  { value: "tabla", label: "Tabla" },
  { value: "tarjetas", label: "Tarjetas" },
  { value: "etapa", label: "Por etapa" },
  { value: "avance", label: "Con avance" },
  { value: "precios", label: "Precios" },
  { value: "importe", label: "Por importe" },
  { value: "mosaico", label: "Mosaico" },
  { value: "resumen", label: "Resumen" },
] as const;
export type DisenoItems = (typeof DISENOS_ITEMS)[number]["value"];

export type PantallaDiseno = "pagos" | "logistica" | "orden-logistica" | "orden-tesoreria" | "orden-consulta";

const MAX_EDAD = 60 * 60 * 24 * 365;
export const cookieDiseno = (p: PantallaDiseno) => `prod1_diseno_${p}`;
export const cookieFijar = (p: PantallaDiseno) => `prod1_fijar_${p}`;

export const disenosDe = (p: PantallaDiseno): readonly { value: Diseno; label: string }[] =>
  p === "logistica" ? DISENOS_LOGISTICA : DISENOS;
export const leerDiseno = (v: string | undefined, p: PantallaDiseno = "pagos"): Diseno =>
  disenosDe(p).find((d) => d.value === v)?.value ?? "lista";
export const leerDisenoItems = (v: string | undefined): DisenoItems => DISENOS_ITEMS.find((d) => d.value === v)?.value ?? "lista";
export const leerFijar = (v: string | undefined) => v === "1";

/** Desde el navegador: guarda el diseño y, si la pantalla lo tiene, si los filtros quedan fijos. */
export function guardarDiseno(p: PantallaDiseno, diseno: string, fijar: boolean | null) {
  document.cookie = `${cookieDiseno(p)}=${diseno}; path=/; max-age=${MAX_EDAD}; samesite=lax`;
  if (fijar != null) document.cookie = `${cookieFijar(p)}=${fijar ? "1" : "0"}; path=/; max-age=${MAX_EDAD}; samesite=lax`;
}

/** Clases del bloque de filtros, pestañas y buscador cuando queda fijo bajo la barra superior (h-15 + borde). */
export const CLASE_FIJO = "sticky top-[61px] z-10 -mx-4 flex flex-col gap-3 border-b border-line bg-bg px-4 py-3";

// ------------------------------------------------------------------ listas agrupadas
const AGRUPADOS = ["obra", "proveedor", "fecha", "empresa", "monto"] as const;
export type Agrupado = (typeof AGRUPADOS)[number];
export const esAgrupado = (d: Diseno): d is Agrupado => (AGRUPADOS as readonly string[]).includes(d);

/** Lo que hace falta de una orden para ubicarla en su grupo. */
export type FilaGrupo = { obra_id: number | null; obra: string | null; proveedor: string | null; empresa: string | null; fecha: string | null; monto: number };

// Rangos de «Por monto», del mayor al menor (mismos cortes que el filtro de monto).
const RANGOS = [
  { clave: "alto", titulo: "Más de 10,000", desde: 10000 },
  { clave: "medio", titulo: "De 1,000 a 10,000", desde: 1000 },
  { clave: "bajo", titulo: "Menos de 1,000", desde: -Infinity },
];

/** Grupo de una orden en un diseño agrupado: su clave (para sumar) y su título. */
export function grupoDe(d: Agrupado, f: FilaGrupo): { clave: string; titulo: string } {
  switch (d) {
    case "obra":
      return { clave: `o${f.obra_id}`, titulo: f.obra ?? "" };
    case "proveedor":
      return { clave: `p${f.proveedor}`, titulo: f.proveedor ?? "" };
    case "empresa":
      return { clave: `e${f.empresa}`, titulo: f.empresa ?? "" };
    case "fecha": {
      const dia = (f.fecha ?? "").slice(0, 10);
      return { clave: `f${dia}`, titulo: dia ? fecha(dia) : "Sin fecha" };
    }
    case "monto": {
      const r = RANGOS.find((x) => f.monto >= x.desde)!;
      return { clave: `m${r.clave}`, titulo: r.titulo };
    }
  }
}

/** Orden de los grupos: en el que aparecen, salvo «Por monto», del mayor al menor. */
export const ordenGrupos = (d: Agrupado, claves: string[]) =>
  d === "monto" ? [...claves].sort((a, b) => RANGOS.findIndex((r) => `m${r.clave}` === a) - RANGOS.findIndex((r) => `m${r.clave}` === b)) : claves;

/** Cantidad y suma por grupo, para todos los diseños agrupados a la vez (`prefijo`: p. ej. el tipo de documento). */
export function totalesPorGrupo(filas: FilaGrupo[], prefijo = "") {
  const t = new Map<string, { n: number; suma: number }>();
  for (const f of filas)
    for (const d of AGRUPADOS) {
      const k = `${prefijo}${grupoDe(d, f).clave}`;
      const x = t.get(k) ?? { n: 0, suma: 0 };
      x.n += 1;
      x.suma += f.monto;
      t.set(k, x);
    }
  return t;
}
