"use server";

import { revalidatePath } from "next/cache";
import { SERIE_INVALIDA, serieValida } from "@/lib/serie";
import { after } from "next/server";
import { z } from "zod";
import { enviarSiLista } from "@/lib/enviar-si-lista";
import { enviarAvisosPendientes } from "@/lib/push";
import { hoyISO } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): Result<never> => ({ ok: false, error });

async function db() {
  await requireSesion(["LOGISTICA"]);
  return createClient();
}

const ordenPath = (obraId: number, numero: string) =>
  `/logistica/ordenes/${obraId}/${encodeURIComponent(numero)}`;

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

const CrearOrden = z
  .object({
    obraId: z.number().int().positive(),
    /** Solo se muestra: el N° lo pone la base (el siguiente de la obra). */
    numero: z.string().optional(),
    proveedorId: z.number().int().positive("Selecciona el proveedor"),
    tipo: z.enum(["OC", "OS"]),
    requiereGuia: z.boolean().default(false),
    /** OS: comprobante que emitirá el proveedor (define el contrato) y fecha de inicio de los trabajos. */
    comprobante: z.enum(["RXH", "FACTURA"], { error: "Elige el comprobante" }).optional(),
    fechaInicio: FECHA.optional(),
    items: z
      .array(z.object({ partida_id: z.number().int(), cantidad: z.number().positive(), ret_garantia_pct: z.number().min(0).lt(100).optional() }))
      .min(1, "Selecciona al menos una partida"),
    /** Si viene de un borrador de la cuenta: se borra al emitir. */
    borradorId: z.number().int().positive().optional(),
  })
  .refine((o) => o.tipo === "OC" || o.comprobante, { message: "Elige el comprobante" })
  .refine((o) => o.tipo === "OC" || o.fechaInicio, { message: "Ingresa la fecha de inicio" })
  // La fecha de fin es la de la OS (hoy, en Lima): el inicio no puede ser posterior.
  .refine((o) => o.tipo === "OC" || (o.fechaInicio ?? "") <= hoyISO(), { message: "La fecha de inicio no puede ser posterior a la de fin" });

export async function crearOrden(input: z.input<typeof CrearOrden>): Promise<Result<string>> {
  const p = CrearOrden.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  // Abierto en dos dispositivos: el segundo no emite otra orden con lo mismo.
  if (p.data.borradorId) {
    const { data: sigue } = await supabase.from("orden_borradores").select("id").eq("id", p.data.borradorId).maybeSingle();
    if (!sigue) return fail("Este borrador ya se emitió o se eliminó");
  }
  const { data, error } = await supabase.rpc("crear_orden", {
    p_obra_id: p.data.obraId,
    // Sin N°: la base pone el siguiente de la obra (nunca repite el de una anulada).
    p_numero: null as unknown as string,
    p_proveedor_id: p.data.proveedorId,
    p_tipo: p.data.tipo,
    p_items: p.data.items,
  });
  if (error) return fail(error.message);
  if (p.data.tipo === "OC" && p.data.requiereGuia) {
    const { error: eg } = await supabase.rpc("set_requiere_guia", { p_obra_id: p.data.obraId, p_numero: String(data), p_requiere: true });
    if (eg) return fail(eg.message);
  }
  if (p.data.tipo === "OS") {
    const { error: eo } = await supabase.rpc("set_datos_os", {
      p_obra_id: p.data.obraId,
      p_numero: String(data),
      p_comprobante: p.data.comprobante!,
      p_fecha_inicio: p.data.fechaInicio!,
    });
    if (eo) return fail(eo.message);
  }
  if (p.data.borradorId) await supabase.from("orden_borradores").delete().eq("id", p.data.borradorId);
  revalidatePath("/logistica");
  return { ok: true, data: String(data) };
}

const BorradorOrden = z.object({
  id: z.number().int().positive().nullable(),
  tipo: z.enum(["OC", "OS"]),
  obraId: z.number().int().positive(),
  datos: z.object({
    paso: z.union([z.literal(1), z.literal(2)]),
    sel: z.array(z.tuple([z.number().int(), z.string().max(30)])).min(1, "Elige al menos una partida").max(5000),
    proveedorId: z.string().max(20).nullable(),
    comprobante: z.enum(["RXH", "FACTURA"]).nullable(),
    fechaInicio: z.string().max(10),
    requiereGuia: z.boolean(),
    garantia: z.object({ mano: z.string().max(8), sub: z.string().max(8), adic: z.string().max(8) }).optional(),
  }),
});

/** Guarda lo avanzado de una Nueva OC / OS en la cuenta (nuevo o sobre el que se retomó). */
export async function guardarBorradorOrden(input: z.input<typeof BorradorOrden>): Promise<Result<number>> {
  const p = BorradorOrden.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const fila = { tipo: p.data.tipo, obra_id: p.data.obraId, datos: p.data.datos };
  // Si ya no existe (se emitió en otro dispositivo), queda como uno nuevo: lo escrito no se pierde.
  const previo = p.data.id
    ? await supabase.from("orden_borradores").update({ ...fila, updated_at: new Date().toISOString() }).eq("id", p.data.id).select("id").maybeSingle()
    : null;
  if (previo?.error) return fail(previo.error.message);
  if (previo?.data) {
    revalidatePath("/logistica");
    return { ok: true, data: previo.data.id };
  }
  const { data, error } = await supabase.from("orden_borradores").insert(fila).select("id").single();
  if (error) return fail(error.message);
  revalidatePath("/logistica");
  return { ok: true, data: data.id };
}

export async function eliminarBorradorOrden(id: number): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from("orden_borradores").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/logistica");
  return { ok: true, data: undefined };
}

/** OS de retenciones: devuelve a un proveedor lo retenido en sus OS pagadas de una obra cerrada. */
export async function crearOsRetenciones(obraId: number, proveedorId: number): Promise<Result<string>> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("crear_orden_retencion", {
    p_obra_id: obraId,
    p_numero: null as unknown as string,
    p_proveedor_id: proveedorId,
  });
  if (error) return fail(error.message);
  revalidatePath("/logistica/retenciones");
  return { ok: true, data: String(data) };
}

const Precios = z.object({
  obraId: z.number().int(),
  numero: z.string(),
  precios: z.array(
    z.object({
      item_id: z.number().int(),
      pu: z.number().nonnegative().nullable(),
      pu_aprobado: z.number().nonnegative().nullable(),
    }),
  ),
  confirmar: z.boolean(),
});

export async function guardarPrecios(input: z.input<typeof Precios>): Promise<Result> {
  const p = Precios.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const { obraId, numero, precios, confirmar } = p.data;
  const { error } = await supabase.rpc("guardar_precios", {
    p_obra_id: obraId,
    p_numero: numero,
    p_precios: precios,
  });
  if (error) return fail(error.message);
  if (confirmar) {
    const { error: e2 } = await supabase.rpc("confirmar_precios", { p_obra_id: obraId, p_numero: numero });
    if (e2) return fail(e2.message);
    // Tras un rechazo con la factura conservada queda facturada: si no le falta nada, va sola a Tesorería.
    const e3 = await enviarSiLista(supabase, obraId, numero);
    if (e3) return fail(e3);
  }
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

const Comprobante = z.object({
  obraId: z.number().int(),
  numero: z.string(),
  proveedorId: z.number().int(),
  tipo: z.enum(["FACTURA", "RXH", "BOLETA", "RECIBO_SIMPLE", "OTRO"]),
  serie: z.string().trim().min(1, "Ingresa la serie").max(10, "La serie tiene hasta 10 caracteres"),
  numeroComprobante: z.string().trim().min(1, "Ingresa el número").max(20, "El número tiene hasta 20 caracteres"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  total: z.number().positive("Ingresa el total"),
  retencion: z.number().nonnegative(),
  /** Detracción de la factura; sin valor, la que corresponde por sus líneas. */
  detraccion: z.number().nonnegative("La detracción no puede ser negativa").nullable().optional(),
  archivoPath: z.string().nullable(),
  itemIds: z.array(z.number().int()).min(1, "Selecciona al menos una línea"),
  /** OC: si requiere guía (se decide por última vez al facturar). Sin guía, al quedar facturada va directo a Tesorería. */
  requiereGuia: z.boolean().optional(),
}).refine((c) => serieValida(c.tipo, c.serie), { message: SERIE_INVALIDA });

export async function registrarComprobante(input: z.input<typeof Comprobante>): Promise<Result> {
  const p = Comprobante.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const c = p.data;
  const { data: o } = await supabase
    .from("ordenes_compra")
    .select("tipo, requiere_guia, historico")
    .eq("obra_id", c.obraId)
    .eq("numero", c.numero)
    .maybeSingle();
  if (!o) return fail("La orden no existe");
  // Datos normales: la factura va con su archivo. Solo las órdenes del Excel (históricas) pueden no tenerlo.
  if (!o.historico && !c.archivoPath) return fail("Sube el archivo del comprobante");
  if (o.tipo === "OC" && c.requiereGuia != null && c.requiereGuia !== o.requiere_guia) {
    const { error: eg } = await supabase.rpc("set_requiere_guia", { p_obra_id: c.obraId, p_numero: c.numero, p_requiere: c.requiereGuia });
    if (eg) return fail(eg.message);
  }
  // OS: si llega el otro comprobante, la base regenera el contrato al registrarlo (el firmado deja de servir).
  const { error } = await supabase.rpc("registrar_comprobante", {
    p_proveedor_id: c.proveedorId,
    p_tipo: c.tipo,
    p_serie: c.serie.toUpperCase(),
    p_numero: c.numeroComprobante,
    p_fecha: c.fecha,
    p_total: c.total,
    p_retencion: c.retencion,
    // La función acepta null (comprobante sin archivo); el tipo generado no lo refleja.
    p_archivo_path: c.archivoPath as string,
    p_item_ids: c.itemIds,
    ...(c.detraccion != null ? { p_detraccion: c.detraccion } : {}),
  });
  if (error) return fail(error.message);
  // Facturada con lo que le toca (sin guía, o con la guía o el contrato ya registrados): va sola a Tesorería.
  const et = await enviarSiLista(supabase, c.obraId, c.numero);
  if (et) return fail(et);
  revalidatePath(ordenPath(c.obraId, c.numero));
  return { ok: true, data: undefined };
}

/** OS: otro proveedor, hasta que se le envía el contrato (el link del anterior deja de servir). */
export async function cambiarProveedorOrden(obraId: number, numero: string, proveedorId: number): Promise<Result> {
  if (!(proveedorId > 0)) return fail("Elige el proveedor");
  const supabase = await db();
  const { error } = await supabase.rpc("cambiar_proveedor_orden", { p_obra_id: obraId, p_numero: numero, p_proveedor_id: proveedorId });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  revalidatePath("/logistica");
  return { ok: true, data: undefined };
}

export async function anularOrden(obraId: number, numero: string, motivo: string): Promise<Result> {
  if (!motivo.trim()) return fail("Ingresa el motivo");
  const supabase = await db();
  const { error } = await supabase.rpc("anular_orden", {
    p_obra_id: obraId,
    p_numero: numero,
    p_motivo: motivo.trim(),
  });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

const Proveedor = z.object({
  id: z.number().int().nullable(),
  ruc_o_cod: z.string().trim().min(8, "RUC/DNI inválido").max(20),
  razon_social: z.string().trim().min(2, "Ingresa la razón social").max(200),
  comprobante_habitual: z.enum(["FACTURA", "RXH", "BOLETA", "RECIBO_SIMPLE", "OTRO"]).nullable(),
  /** Retención de 4ta (recibos por honorarios de más de S/ 1,500): 8 % salvo otro caso. */
  retencion_4ta_pct: z.number().min(0, "Retención inválida").max(99, "Retención inválida").default(8),
  /** Suspensión de retenciones de 4ta: solo con la constancia subida (vale hasta el 31/12 de su año). */
  suspension_4ta_fecha: FECHA.nullable().default(null),
  suspension_4ta_path: z.string().trim().min(1).nullable().default(null),
  suspension_4ta_operacion: z.string().trim().regex(/^\d{6,12}$/, "El N° de operación son de 6 a 12 dígitos").nullable().default(null),
  banco: z.string().trim().max(60).nullable(),
  cuenta_bancaria: z.string().trim().max(60).nullable(),
  contactos: z.array(
    z.object({
      nombre: z.string().trim().max(120).nullable(),
      telefono: z
        .string()
        .trim()
        .regex(/^\+?[\d\s-]{6,20}$/, "Teléfono inválido"),
      whatsapp: z.boolean(),
      telegram: z.boolean(),
    }),
  ),
  tipos: z.array(z.string()),
});

export async function guardarProveedor(input: z.input<typeof Proveedor>): Promise<Result<{ id: number; suspension: string | null }>> {
  const p = Proveedor.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const { id, contactos, tipos, banco, cuenta_bancaria, ...row } = p.data;
  if ((row.suspension_4ta_fecha == null) !== (row.suspension_4ta_path == null && row.suspension_4ta_operacion == null))
    return fail("Para registrar la suspensión de 4ta ingresa su fecha y su constancia o N° de operación");
  if (row.suspension_4ta_fecha && row.suspension_4ta_fecha > hoyISO()) return fail("La fecha de la constancia no puede ser futura");
  const q = id
    ? supabase.from("proveedores").update(row).eq("id", id).select("id, suspension_4ta_fecha").single()
    : supabase.from("proveedores").insert(row).select("id, suspension_4ta_fecha").single();
  const { data, error } = await q;
  if (error) return fail(error.code === "23505" ? "Ya existe un proveedor con ese RUC" : error.message);

  // La cuenta bancaria va en proveedor_cuentas (lectura restringida por rol).
  const provId = data.id;
  const { error: eCuenta } =
    banco || cuenta_bancaria
      ? await supabase.from("proveedor_cuentas").upsert({ proveedor_id: provId, banco: banco || null, cuenta_bancaria: cuenta_bancaria || null })
      : await supabase.from("proveedor_cuentas").delete().eq("proveedor_id", provId);
  if (eCuenta) return fail(eCuenta.message);

  // Contactos y tipos de material: se reemplazan por los enviados.
  const [d1, d2] = await Promise.all([
    supabase.from("proveedor_contactos").delete().eq("proveedor_id", provId),
    supabase.from("proveedor_tipos_material").delete().eq("proveedor_id", provId),
  ]);
  if (d1.error || d2.error) return fail((d1.error ?? d2.error)!.message);
  const [i1, i2] = await Promise.all([
    contactos.length
      ? supabase.from("proveedor_contactos").insert(contactos.map((c) => ({ ...c, nombre: c.nombre || null, proveedor_id: provId })))
      : Promise.resolve({ error: null }),
    tipos.length
      ? supabase.from("proveedor_tipos_material").insert(tipos.map((t) => ({ proveedor_id: provId, tipo_material: t })))
      : Promise.resolve({ error: null }),
  ]);
  if (i1.error || i2.error) return fail((i1.error ?? i2.error)!.message);

  revalidatePath("/logistica/proveedores");
  // La base pudo ponerle una suspensión conocida por su RUC.
  return { ok: true, data: { id: provId, suspension: data.suspension_4ta_fecha } };
}

// Prod 1: los ítems los crea Gerencia (crearItem en src/app/gerencia/actions.ts); Logística los clasifica.
export async function actualizarTipoMaterial(itemId: number, tipo: string | null): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from("items").update({ tipo_material: tipo }).eq("id", itemId);
  if (error) return fail(error.message);
  revalidatePath("/logistica/items");
  return { ok: true, data: undefined };
}

/** Tipo de material nuevo (Ítems y Proveedores); devuelve el código creado. */
export async function crearTipoMaterial(nombre: string): Promise<Result<string>> {
  const codigo = nombre.trim().replace(/\s+/g, " ").toUpperCase();
  if (codigo.length < 3 || codigo.length > 40) return fail("Escribe un nombre de 3 a 40 letras");
  const supabase = await db();
  const { data: ultimo } = await supabase.from("tipos_material").select("orden").order("orden", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("tipos_material").insert({ codigo, orden: (ultimo?.orden ?? 0) + 1 });
  if (error) return fail(error.code === "23505" ? "Ese tipo ya existe" : error.message);
  revalidatePath("/logistica/items");
  revalidatePath("/logistica/proveedores");
  return { ok: true, data: codigo };
}

// ------------------------------------------------------------ link de cotización
const Orden = z.object({ obraId: z.number().int().positive(), numero: z.string().trim().min(1) });

/** Al compartir el link (WhatsApp, Telegram o copiar): la cotización queda "enviada". */
export async function marcarCotizacionEnviada(obraId: number, numero: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("marcar_cotizacion_enviada", { p_obra_id: obraId, p_numero: numero });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

/** Link nuevo para que el proveedor corrija: el anterior deja de funcionar. */
export async function reenviarCotizacion(obraId: number, numero: string): Promise<Result<string>> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { data, error } = await supabase.rpc("reenviar_cotizacion", { p_obra_id: obraId, p_numero: numero });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: String(data) };
}

// ------------------------------------------------------------ flujo con Tesorería
/** Con todos los comprobantes registrados, la orden pasa a Tesorería. */
export async function enviarATesoreria(obraId: number, numero: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("enviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero });
  if (error) return fail(error.message);
  after(enviarAvisosPendientes);
  revalidatePath(ordenPath(obraId, numero));
  revalidatePath("/logistica");
  return { ok: true, data: undefined };
}

/** Reenvía a Tesorería la orden rechazada por datos o documentos, con lo que se corrigió (queda en el rechazo). */
export async function reenviarATesoreria(obraId: number, numero: string, nota: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("reenviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero, p_nota: nota.trim().slice(0, 500) });
  if (error) return fail(error.message);
  after(enviarAvisosPendientes);
  revalidatePath(ordenPath(obraId, numero));
  revalidatePath("/logistica");
  return { ok: true, data: undefined };
}

/** Glosa del recibo por honorarios de una OS (va en el contrato y se le envía al proveedor). */
export async function guardarGlosaRhe(obraId: number, numero: string, glosa: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  if (glosa.trim().length < 5) return fail("Escribe el concepto del recibo");
  const supabase = await db();
  const { error } = await supabase.rpc("guardar_glosa_rhe", { p_obra_id: obraId, p_numero: numero, p_glosa: glosa.trim() });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

/** El contrato de la OS se le envió al proveedor (WhatsApp, Telegram o compartir). */
export async function marcarContratoEnviado(obraId: number, numero: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("enviar_contrato", { p_obra_id: obraId, p_numero: numero });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

/** Se envió la constancia de pago al proveedor: empieza la entrega. */
export async function enviarConstancia(obraId: number, numero: string): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("enviar_constancia", { p_obra_id: obraId, p_numero: numero });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  revalidatePath("/logistica");
  return { ok: true, data: undefined };
}

// ------------------------------------------------------------ guía de remisión
export async function setRequiereGuia(obraId: number, numero: string, requiere: boolean): Promise<Result> {
  const p = Orden.safeParse({ obraId, numero });
  if (!p.success) return fail("Orden inválida");
  const supabase = await db();
  const { error } = await supabase.rpc("set_requiere_guia", { p_obra_id: obraId, p_numero: numero, p_requiere: requiere });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

const Guia = z.object({
  obraId: z.number().int().positive(),
  numero: z.string().min(1),
  modalidad: z.enum(["PROVEEDOR", "PROPIO", "TERCERO"]),
  transportista_id: z.number().int().positive().nullable(),
  punto_partida: z.string().trim().min(3, "Ingresa el punto de partida").max(300),
  punto_llegada: z.string().trim().min(3, "Ingresa el punto de llegada").max(300),
  placa: z.string().trim().min(5, "Ingresa la placa").max(12),
  licencia: z.string().trim().min(5, "Ingresa el N° de licencia").max(20),
  detalle: z.string().trim().min(3, "Ingresa los ítems y cantidades").max(4000),
  fecha_traslado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

/** Prod 1 (sin Contabilidad): Logística registra la guía ya emitida, con su N° y el archivo. */
export async function registrarGuia(input: z.input<typeof Guia>, numeroGuia: string, archivoPath: string): Promise<Result> {
  const p = Guia.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  if (p.data.modalidad === "TERCERO" && !p.data.transportista_id) return fail("Elige el transportista");
  if (!numeroGuia.trim()) return fail("Ingresa el N° de guía");
  const supabase = await db();
  const { obraId, numero, ...datos } = p.data;
  const { error } = await supabase.rpc("registrar_guia", {
    p_obra_id: obraId,
    p_numero: numero,
    p_datos: datos,
    p_numero_guia: numeroGuia,
    p_archivo_path: archivoPath,
  });
  if (error) return fail(error.message);
  const e2 = await enviarSiLista(supabase, obraId, numero);
  if (e2) return fail(e2);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

/** La guía de una OC anulada ya se anuló en SUNAT. */
export async function marcarGuiaAnulada(obraId: number, numero: string, id: number): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc("marcar_guia_anulada", { p_id: id });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(obraId, numero));
  return { ok: true, data: undefined };
}

const Transportista = z.object({
  id: z.number().int().optional(),
  ruc: z.string().trim().regex(/^\d{11}$/, "El RUC tiene 11 dígitos"),
  razon_social: z.string().trim().min(3, "Ingresa la razón social").max(200),
  placa: z.string().trim().max(12).transform((v) => v.toUpperCase() || null),
  licencia: z.string().trim().max(20).transform((v) => v.toUpperCase() || null),
});

export async function guardarTransportista(input: z.input<typeof Transportista>): Promise<Result<number>> {
  const p = Transportista.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const { id, ...row } = p.data;
  const q = id
    ? supabase.from("transportistas").update(row).eq("id", id).select("id").single()
    : supabase.from("transportistas").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return fail(error.code === "23505" ? "Ya existe un transportista con ese RUC" : error.message);
  revalidatePath("/logistica/transportistas");
  return { ok: true, data: data.id };
}

// ------------------------------------------------------------ corrección de comprobantes
const EdicionComprobante = z.object({
  id: z.number().int().positive(),
  obraId: z.number().int(),
  numero: z.string(),
  tipo: z.enum(["FACTURA", "RXH", "BOLETA", "RECIBO_SIMPLE", "OTRO"]),
  serie: z.string().trim().min(1, "Ingresa la serie").max(10, "La serie tiene hasta 10 caracteres"),
  numeroComprobante: z.string().trim().min(1, "Ingresa el número").max(20, "El número tiene hasta 20 caracteres"),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  total: z.number().positive("Ingresa el total"),
  retencion: z.number().nonnegative(),
  archivoPath: z.string().nullable(),
  motivo: z.string().max(300),
}).refine((c) => serieValida(c.tipo, c.serie), { message: SERIE_INVALIDA });

/** Corrige un comprobante aún no contabilizado ni pagado; lo anterior queda en el historial. */
export async function editarComprobante(input: z.input<typeof EdicionComprobante>): Promise<Result> {
  const p = EdicionComprobante.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await db();
  const c = p.data;
  const { error } = await supabase.rpc("editar_comprobante", {
    p_id: c.id,
    p_tipo: c.tipo,
    p_serie: c.serie,
    p_numero: c.numeroComprobante,
    p_fecha: c.fecha,
    p_total: c.total,
    p_retencion: c.retencion,
    p_archivo_path: c.archivoPath as string,
    p_motivo: c.motivo,
  });
  if (error) return fail(error.message);
  revalidatePath(ordenPath(c.obraId, c.numero));
  return { ok: true, data: undefined };
}

