"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSesionVigente } from "@/lib/supabase/server";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const Empresa = z.object({
  id: z.number().int().positive(),
  razonSocial: z.string().trim().max(200),
  ruc: z
    .string()
    .trim()
    .regex(/^((10|15|17|20)\d{9})?$/, "El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20"),
  direccion: z.string().trim().max(300),
  /** Quien firma sus contratos (Gerencia); vacío: el gerente con la firma más reciente. */
  firmanteId: z.guid().nullable(),
});

/** El Admin completa los datos de una empresa (van en contratos y documentos). Queda en la auditoría a su nombre. */
export async function guardarEmpresa(input: z.input<typeof Empresa>): Promise<Result> {
  const p = Empresa.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sesion = await requireSesionVigente(["ADMIN"]);
  if (sesion.rol !== "ADMIN") return { ok: false, error: "Solo el Administrador edita las empresas" };
  const db = createAdminClient(sesion.userId);
  if (p.data.firmanteId) {
    const { data: f } = await db.from("perfil_roles").select("rol").eq("user_id", p.data.firmanteId).eq("rol", "GERENCIA").maybeSingle();
    if (!f) return { ok: false, error: "El firmante debe ser de Gerencia" };
  }
  const { error } = await db
    .from("empresas")
    .update({
      razon_social: p.data.razonSocial || null,
      ruc: p.data.ruc || null,
      direccion: p.data.direccion || null,
      firmante_id: p.data.firmanteId,
    })
    .eq("id", p.data.id);
  if (error) return { ok: false, error: error.code === "23514" ? "RUC no válido" : error.message };
  revalidatePath("/admin/empresas");
  return { ok: true, data: undefined };
}
