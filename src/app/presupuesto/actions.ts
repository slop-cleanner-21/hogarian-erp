"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { Result } from "@/app/logistica/actions";
import type { VOcItem } from "@/lib/types";
import { todas } from "@/lib/paginar";

// Historial de órdenes de una partida del presupuesto (lo consultan varias áreas).
export type FilaHistorial = Pick<VOcItem, "id" | "obra_id" | "numero_oc" | "fecha" | "cantidad" | "pu_efectivo" | "parcial" | "estado"> & {
  proveedor: string;
};

/**
 * Historial de órdenes de una partida (Consultas › presupuesto de obra). Con `antesDe`, desde el
 * detalle de una orden: solo las órdenes anteriores a ella, sin la propia.
 */
export async function historialPartida(
  partidaId: number,
  antesDe?: { numero: string; fecha: string | null },
): Promise<Result<FilaHistorial[]>> {
  await requireSesion(["TESORERIA", "LOGISTICA", "CONTABILIDAD", "GERENCIA", "OPERACIONES", "JEFE_OPERACIONES"]);
  const supabase = await createClient();
  let consulta = supabase
    .from("v_oc_items_calc")
    .select("id, obra_id, numero_oc, fecha, cantidad, pu_efectivo, parcial, estado")
    .eq("partida_id", partidaId)
    .neq("estado", "ANULADA")
    .order("fecha", { ascending: false })
    .order("id", { ascending: false });
  if (antesDe) {
    consulta = consulta.neq("numero_oc", antesDe.numero);
    // Del mismo día cuentan solo las emitidas antes (número menor).
    if (antesDe.fecha) consulta = consulta.or(`fecha.lt.${antesDe.fecha},and(fecha.eq.${antesDe.fecha},numero_oc.lt."${antesDe.numero.replace(/"/g, "")}")`);
  }
  const { data: lineas, error } = await consulta;
  if (error) return { ok: false, error: error.message };
  if (lineas.length === 0) return { ok: true, data: [] };
  const { data: ordenes, error: e2 } = await supabase
    .from("v_ordenes")
    .select("numero, proveedor")
    .eq("obra_id", lineas[0].obra_id!)
    .in("numero", [...new Set(lineas.map((l) => l.numero_oc!))]);
  if (e2) return { ok: false, error: e2.message };
  const prov = new Map(ordenes.map((o) => [o.numero, o.proveedor]));
  return {
    ok: true,
    data: lineas.map((l) => ({ ...l, proveedor: prov.get(l.numero_oc!) ?? "" })),
  };
}

// ------------------------------------------------------------ edición del presupuesto (Operaciones / Gerencia)
export type PartidaEdicion = {
  id: number | null;
  etapa: string;
  requerimiento: string;
  item_id: number;
  cantidad: number;
  pu: number | null;
};

/** Guarda altas, cambios y bajas de partidas (solo Gerencia carga el presupuesto). */
export async function guardarPartidas(obraId: number, partidas: PartidaEdicion[], eliminar: number[]): Promise<Result<number>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_partidas", { p_obra_id: obraId, p_partidas: partidas, p_eliminar: eliminar });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: Number(data) };
}

/** Retención (%) de cada ítem de mano de obra de la obra (solo Gerencia). */
export async function guardarRetenciones(obraId: number, retenciones: { item_id: number; porcentaje: number }[]): Promise<Result<number>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_retenciones", { p_obra_id: obraId, p_retenciones: retenciones });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: Number(data) };
}

/** Ítems de la obra que llevan detracción y su porcentaje; null la quita (solo Gerencia). */
export async function guardarDetracciones(obraId: number, detracciones: { item_id: number; porcentaje: number | null }[]): Promise<Result<number>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_detracciones", { p_obra_id: obraId, p_detracciones: detracciones });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: Number(data) };
}

/** Monto desde el que una factura lleva detracción (todas las obras; solo Gerencia). */
export async function guardarDetraccionMinimo(monto: number): Promise<Result> {
  await requireSesion(["GERENCIA"]);
  if (!(monto >= 0)) return { ok: false, error: "El mínimo debe ser cero o más" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_detraccion_minimo", { p_monto: monto });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/gerencia/obras");
  return { ok: true, data: undefined };
}

export async function publicarPresupuesto(obraId: number): Promise<Result> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("publicar_presupuesto", { p_obra_id: obraId });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath(`/gerencia/obras/${obraId}`);
  revalidatePath("/gerencia/obras");
  return { ok: true, data: undefined };
}

/** Quita a un residente de la obra dejando a otro en su lugar (no se puede quitar sin reemplazo). */
export async function reemplazarResidente(obraId: number, sale: number, entra: number): Promise<Result> {
  await requireSesion(["JEFE_OPERACIONES", "OPERACIONES", "GERENCIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reemplazar_residente", { p_obra_id: obraId, p_sale: sale, p_entra: entra });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/operaciones/obra");
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: undefined };
}

export async function asignarPersonaObra(obraId: number, personaId: number, asignar: boolean): Promise<Result> {
  await requireSesion(["JEFE_OPERACIONES", "OPERACIONES", "GERENCIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("asignar_persona_obra", { p_obra_id: obraId, p_persona_id: personaId, p_asignar: asignar });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/operaciones/obra");
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: undefined };
}

/**
 * Lo que el cierre da de baja (partidas con saldo y su monto) y la retención por pagar. Se calcula al tocar «Cerrar
 * obra»: el faltante de cada partida es una función por fila y costaba ~0,5 s en cada apertura del editor.
 */
export async function saldoCierre(obraId: number): Promise<Result<{ partidas: number; monto: number; retencion: number }>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const [faltantes, { data: retenido, error }] = await Promise.all([
    todas((a, b) => supabase.from("partidas").select("id, pu, faltante").eq("obra_id", obraId).order("id").range(a, b)),
    supabase.from("valorizaciones").select("valorizacion_partidas(retencion)").eq("obra_id", obraId),
  ]);
  if (error) return { ok: false, error: error.message };
  const conSaldo = faltantes.filter((f) => Number(f.faltante ?? 0) > 0.0001);
  return {
    ok: true,
    data: {
      partidas: conSaldo.length,
      monto: conSaldo.reduce((s, f) => s + Number(f.faltante) * Number(f.pu ?? 0), 0),
      retencion: (retenido ?? []).flatMap((v) => v.valorizacion_partidas).reduce((s, l) => s + Number(l.retencion), 0),
    },
  };
}

/** Cierra la obra: da de baja todo lo que falta y deja la retención lista para su OS final. */
export async function cerrarObra(obraId: number): Promise<Result<number>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cerrar_obra", { p_obra_id: obraId });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath(`/gerencia/obras/${obraId}`);
  revalidatePath("/gerencia/obras");
  return { ok: true, data: Number(data) };
}

/** Gerencia agrega un adicional (partidas con el siguiente «ADIC n» de la obra); Logística recibe un aviso. */
export async function agregarAdicional(
  obraId: number,
  partidas: { etapa: string; item_id: number; cantidad: number; pu: number }[],
): Promise<Result<string>> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agregar_adicional", { p_obra_id: obraId, p_partidas: partidas });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath(`/gerencia/obras/${obraId}`);
  return { ok: true, data: String(data) };
}
