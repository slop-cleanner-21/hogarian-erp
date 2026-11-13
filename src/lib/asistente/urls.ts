// Enlaces de las pantallas de Tesorería con sus filtros, armados por el servidor desde ids y opciones validadas: el
// asistente nunca escribe una URL. Mismos parámetros que leen las pantallas (src/app/tesoreria/page.tsx y
// src/app/presupuesto/pagina.tsx).
import { z } from "zod";
import { RANGO_RE } from "@/lib/filtros";

/** Fecha de la lista: 7d, 30d, mes, mesant o un rango AAAA-MM-DD_AAAA-MM-DD. */
export const FECHA = z.union([z.enum(["7d", "30d", "mes", "mesant"]), z.string().regex(RANGO_RE, "Rango AAAA-MM-DD_AAAA-MM-DD")]);
const ETAPA = z.string().trim().min(1).max(20);

export const FiltrosPagos = z.object({
  /** La pantalla exige la empresa: sin ella muestra la entrada. `todas` = todas las empresas. */
  empresa_id: z.union([z.number().int().positive(), z.literal("todas")]),
  obra_id: z.number().int().positive().optional(),
  doc: z.enum(["OC", "OS"]).default("OC"),
  estado: z.enum(["pendiente", "pagado", "rechazos"]).default("pendiente"),
  proveedor_id: z.number().int().positive().optional(),
  etapas: z.array(ETAPA).max(30).optional(),
  fecha: FECHA.optional(),
  monto: z.enum(["bajo", "medio", "alto"]).optional(),
  orden: z.enum(["fecha.asc", "fecha.desc", "monto.desc", "monto.asc", "proveedor.asc", "numero.asc"]).optional(),
});
export type FiltrosPagos = z.input<typeof FiltrosPagos>;

const EST = { pendiente: "pend", pagado: "pag", rechazos: "rec" } as const;

/** `/tesoreria?…`. Siempre lleva `doc` y `est`, así el proxy no la cambia por la vista guardada (su base es empresa). */
export function urlPagos(f: FiltrosPagos): string {
  const p = FiltrosPagos.parse(f);
  const q = new URLSearchParams();
  q.set("empresa", String(p.empresa_id));
  q.set("area", "log");
  q.set("doc", p.doc);
  q.set("est", EST[p.estado]);
  if (p.obra_id) q.set("obra", String(p.obra_id));
  if (p.proveedor_id) q.set("proveedor", String(p.proveedor_id));
  // La pestaña Rechazos no filtra por etapas ni por monto (la pantalla no los tiene ahí).
  if (p.etapas?.length && p.estado !== "rechazos") q.set("etapa", [...new Set(p.etapas)].join(","));
  if (p.fecha) q.set("fecha", p.fecha);
  if (p.monto && p.estado !== "rechazos") q.set("monto", p.monto);
  if (p.orden) q.set("orden", p.orden);
  return `/tesoreria?${q}`;
}

export const FiltrosPresupuesto = z.object({
  obra_id: z.number().int().positive(),
  empresa_id: z.number().int().positive().optional(),
  rubro: z.enum(["MATERIAL", "MANO OBRA", "SUBCONTRATO"]).default("MATERIAL"),
  etapas: z.array(ETAPA).max(30).optional(),
  pago: z.enum(["porpagar", "parcial", "completo", "sinpagar"]).optional(),
  busqueda: z.string().trim().max(60).optional(),
});
export type FiltrosPresupuesto = z.input<typeof FiltrosPresupuesto>;

/** `/tesoreria/consultas?…` (Presupuesto de una obra). */
export function urlPresupuesto(f: FiltrosPresupuesto): string {
  const p = FiltrosPresupuesto.parse(f);
  const q = new URLSearchParams();
  if (p.empresa_id) q.set("empresa", String(p.empresa_id));
  q.set("obra", String(p.obra_id));
  q.set("rubro", p.rubro);
  if (p.etapas?.length) q.set("etapa", [...new Set(p.etapas)].join(","));
  if (p.pago) q.set("pago", p.pago);
  if (p.busqueda) q.set("q", p.busqueda);
  return `/tesoreria/consultas?${q}`;
}

// Lo que comparten la hoja (cliente) y la ruta.
export const MAX_TURNOS = 20;

/** Los últimos turnos, empezando por una pregunta (la API no acepta empezar con una respuesta). */
export function historialDe(turnos: { rol: "usuario" | "asistente"; texto: string }[]) {
  const ultimos = turnos.slice(-MAX_TURNOS);
  const desde = ultimos.findIndex((t) => t.rol === "usuario");
  return desde < 0 ? [] : ultimos.slice(desde).map(({ rol, texto }) => ({ rol, texto }));
}

/** Solo se navega a Pagos o al Presupuesto de Tesorería (el enlace lo arma el servidor; igual se revisa). */
export function destinoValido(url: string): boolean {
  try {
    const u = new URL(url, "https://app.local");
    return u.origin === "https://app.local" && (u.pathname === "/tesoreria" || u.pathname === "/tesoreria/consultas") && !u.hash;
  } catch {
    return false;
  }
}
