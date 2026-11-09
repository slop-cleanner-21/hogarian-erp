"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { Result } from "@/app/logistica/actions";
import { todas } from "@/lib/paginar";
import { parecidos } from "@/lib/parecidos";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient, requireSesion } from "@/lib/supabase/server";

const Item = z.object({
  descripcion: z.string().trim().min(3, "Ingresa la descripción").max(255),
  unidad: z.string().trim().min(1, "Ingresa la unidad").max(20),
  rubro: z.enum(["MATERIAL", "MANO OBRA", "SUBCONTRATO", "LOCACION", "PROYECTO", "FINALIZACION", "OTRO"]),
  tolerancia_pct: z.number().min(0).max(1),
  tipo_material: z.string().nullable(),
  /** Cuenta contable del ítem (la del asiento de compra): opcional. */
  cuenta_contable: z.string().trim().min(1).nullable().default(null),
  /** Confirmó que no es el ítem casi igual que ya existe. */
  es_otro: z.boolean().default(false),
});

/** Gerencia crea un ítem del catálogo (material o servicio); Logística lo clasifica después si hace falta. */
export async function crearItem(input: z.input<typeof Item>): Promise<Result<number>> {
  const p = Item.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  // El mismo ítem escrito de otra forma no se crea; uno casi igual, solo si se confirmó que es otro.
  const catalogo = await todas<{ descripcion: string }>((d, h) => supabase.from("items").select("descripcion").order("id").range(d, h));
  const [repetido] = parecidos(p.data.descripcion, catalogo, 1);
  if (repetido?.igual) return { ok: false, error: `Ya existe: ${repetido.item.descripcion}` };
  const { es_otro: esOtro, ...datos } = p.data;
  if (repetido?.casi && !esOtro) return { ok: false, error: `Ya existe uno casi igual: ${repetido.item.descripcion}` };
  const row = { ...datos, descripcion: datos.descripcion.toUpperCase(), unidad: datos.unidad.toUpperCase() };
  const { data, error } = await supabase.from("items").insert(row).select("id").single();
  if (error) return { ok: false, error: error.code === "23505" ? "Ya existe un ítem con esa descripción" : error.message };
  revalidatePath("/gerencia/items");
  revalidatePath("/logistica/items");
  return { ok: true, data: data.id };
}

const Obra = z.object({
  id: z.number().int().nullable(),
  nombre: z.string().trim().min(3, "Ingresa el nombre de la obra").max(120),
  empresaId: z.number().int().positive("Elige la empresa"),
  direccion: z.string().trim().max(300),
});

/** Gerencia crea o edita una obra (las nuevas nacen con el presupuesto en borrador). */
export async function guardarObra(input: z.input<typeof Obra>): Promise<Result<number>> {
  const p = Obra.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardar_obra", {
    p_id: p.data.id as number,
    p_nombre: p.data.nombre,
    p_empresa_id: p.data.empresaId,
    p_direccion: p.data.direccion,
  });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath("/gerencia/obras");
  return { ok: true, data: Number(data) };
}

/** Aprueba o rechaza una solicitud de Obras o de RRHH; se avisa a quien la pidió. */
export async function resolverSolicitud(id: number, aprobar: boolean, respuesta: string): Promise<Result> {
  await requireSesion(["GERENCIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolver_solicitud", { p_id: id, p_aprobar: aprobar, p_respuesta: respuesta });
  if (error) return { ok: false, error: error.message };
  after(enviarAvisosPendientes);
  revalidatePath("/gerencia/solicitudes");
  return { ok: true, data: undefined };
}
