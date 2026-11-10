import { zipSync, strToU8 } from "fflate";
import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { archivosPlame, type ReciboPlame } from "@/lib/sunat";
import { createClient, requireSesion } from "@/lib/supabase/server";

// Archivos del PLAME (rentas de cuarta categoría) de una empresa y un mes: todos los recibos por honorarios pagados ese mes
// (con o sin retención), en un ZIP con el .ps4 (prestadores) y el .4ta (recibos).   ?empresa=2&periodo=202611

export async function GET(request: Request) {
  await requireSesion(ROLES_CONTABILIDAD);
  const url = new URL(request.url);
  const empresa = Number(url.searchParams.get("empresa"));
  const periodo = url.searchParams.get("periodo") ?? "";
  if (!(empresa > 0) || !/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return new Response("Parámetros inválidos", { status: 400 });
  const supabase = await createClient();
  const [{ data: emp }, { data, error }] = await Promise.all([
    supabase.from("empresas").select("ruc").eq("id", empresa).single(),
    supabase
      .from("comprobantes")
      .select("serie, numero, total, retencion, fecha_emision, proveedores(ruc_o_cod, razon_social), pago_aplicaciones(pagos(fecha))")
      .eq("empresa_id", empresa)
      .eq("tipo", "RXH")
      .is("anulado_at", null)
      .limit(5000),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  if (!emp?.ruc || !/^\d{11}$/.test(emp.ruc)) return new Response("La empresa no tiene un RUC de 11 dígitos", { status: 400 });
  type C = {
    serie: string;
    numero: string;
    total: number;
    retencion: number;
    fecha_emision: string;
    proveedores: { ruc_o_cod: string; razon_social: string } | null;
    pago_aplicaciones: { pagos: { fecha: string } | null }[];
  };
  const recibos: ReciboPlame[] = [];
  for (const c of data as unknown as C[]) {
    // El mes del pago (cuando se retiene): el último pago del recibo.
    const pago = c.pago_aplicaciones.map((a) => a.pagos?.fecha ?? "").sort().at(-1);
    if (!pago || pago.slice(0, 7).replace("-", "") !== periodo) continue;
    recibos.push({
      documento: c.proveedores?.ruc_o_cod ?? "",
      nombre: c.proveedores?.razon_social ?? "",
      serie: c.serie,
      numero: c.numero,
      total: Number(c.total),
      emision: c.fecha_emision,
      pago,
      retencion: Number(c.retencion),
    });
  }
  if (!recibos.length) return new Response("No hay recibos por honorarios pagados en ese mes", { status: 404 });
  const { ps4, cuarta } = archivosPlame(emp.ruc, periodo, recibos);
  const zip = zipSync({ [ps4.nombre]: strToU8(ps4.contenido), [cuarta.nombre]: strToU8(cuarta.contenido) });
  return new Response(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="PLAME-4ta-${emp.ruc}-${periodo}.zip"` },
  });
}
