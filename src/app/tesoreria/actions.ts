"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { enviarAvisosPendientes } from "@/lib/push";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { Result } from "@/app/logistica/actions";

const fail = (error: string): Result<never> => ({ ok: false, error });

async function db() {
  await requireSesion(["TESORERIA"]);
  return createClient();
}

const Pago = z
  .object({
    obraId: z.number().int().nullable(),
    numero: z.string().nullable(),
    ordenPagoId: z.number().int().nullable(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    banco: z.string().trim().min(1, "Selecciona el banco"),
    numeroOperacion: z.string().trim().min(1, "Ingresa el N° de operación").max(40),
    monto: z.number().positive("Ingresa el monto"),
    voucherPath: z.string().min(1, "Sube el voucher"),
    voucherNombre: z.string().min(1),
  })
  .refine((p) => (p.ordenPagoId != null) !== (p.obraId != null && p.numero != null), "Documento inválido");

/** "Aprobar pago": registra el pago con su voucher en un solo paso. */
export async function pagarDocumento(input: z.input<typeof Pago>): Promise<Result<number>> {
  const supabase = await db();
  const p = Pago.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const { data, error } = await supabase.rpc("pagar_documento", {
    p_obra_id: d.obraId as number,
    p_numero: d.numero as string,
    p_orden_pago_id: d.ordenPagoId as number,
    p_fecha: d.fecha,
    p_banco: d.banco,
    p_numero_operacion: d.numeroOperacion,
    p_monto: d.monto,
    p_voucher_path: d.voucherPath,
    p_voucher_nombre: d.voucherNombre,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tesoreria");
  return { ok: true, data: Number(data) };
}

const Rechazo = z.object({
  obraId: z.number().int().nullable(),
  numero: z.string().nullable(),
  ordenPagoId: z.number().int().nullable(),
  motivo: z.string().max(500),
  /**
   * Qué hay que corregir (OC/OS): DATOS (vuelve a Guía/Contrato con su factura), FACTURA (a Facturar: se anula
   * la factura) o PRECIOS (a Cotizando, también se anula la factura).
   */
  correccion: z.enum(["DATOS", "FACTURA", "PRECIOS"]).optional(),
}).refine((r) => r.ordenPagoId != null || r.motivo.trim().length >= 5, { message: "Escribe el motivo: es lo que Logística va a corregir" });

/** Devuelve el documento a quien lo envió (Logística o Contabilidad), con el motivo en el historial. */
export async function rechazarDocumento(input: z.input<typeof Rechazo>): Promise<Result> {
  const p = Rechazo.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  await requireSesion(["TESORERIA"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("rechazar_documento", {
    p_obra_id: p.data.obraId as number,
    p_numero: p.data.numero as string,
    p_orden_pago_id: p.data.ordenPagoId as number,
    p_motivo: p.data.motivo,
    p_factura_nueva: p.data.correccion != null && p.data.correccion !== "DATOS",
    ...(p.data.correccion ? { p_correccion: p.data.correccion } : {}),
  });
  if (error) return fail(error.message);
  after(enviarAvisosPendientes);
  revalidatePath("/tesoreria");
  return { ok: true, data: undefined };
}
