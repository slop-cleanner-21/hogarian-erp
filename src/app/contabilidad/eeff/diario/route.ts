import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";

// Libro diario de un mes en CSV (Excel lo abre): una fila por línea de asiento.

const ORIGEN: Record<string, string> = { COMPRA: "Compra", PAGO: "Pago", IMPUESTO: "Impuesto", MANUAL: "Manual" };
/** Celda CSV sin fórmulas (Excel ejecuta lo que empieza con = + - @). */
const celda = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  await requireSesion(ROLES_CONTABILIDAD);
  const url = new URL(request.url);
  const empresa = Number(url.searchParams.get("empresa"));
  const periodo = url.searchParams.get("periodo") ?? "";
  if (!(empresa > 0) || !/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return new Response("Parámetros inválidos", { status: 400 });
  const fin = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(4)), 0)).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: emp }, { data, error }] = await Promise.all([
    supabase.from("empresas").select("nombre").eq("id", empresa).single(),
    supabase
      .from("asientos")
      .select("id, fecha, glosa, origen, asiento_lineas(cuenta, debe, haber, glosa, orden, cuentas_contables!asiento_lineas_cuenta_fkey(denominacion))")
      .eq("empresa_id", empresa)
      .gte("fecha", `${periodo.slice(0, 4)}-${periodo.slice(4)}-01`)
      .lte("fecha", fin)
      .order("fecha")
      .order("id")
      .limit(5000),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  type L = { cuenta: string; debe: number; haber: number; glosa: string | null; orden: number | null; cuentas_contables: { denominacion: string } | null };
  const filas = [["N° asiento", "Fecha", "Origen", "Glosa", "Cuenta", "Denominación", "Debe", "Haber"]];
  data.forEach((a, i) => {
    for (const l of (a.asiento_lineas as unknown as L[]).sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))) {
      filas.push([String(i + 1), a.fecha, ORIGEN[a.origen] ?? a.origen, l.glosa || a.glosa, l.cuenta, l.cuentas_contables?.denominacion ?? "", Number(l.debe).toFixed(2), Number(l.haber).toFixed(2)]);
    }
  });
  // Con BOM y punto y coma: Excel en español lo abre en columnas y con las tildes bien.
  const csv = "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
  const nombre = `diario-${(emp?.nombre ?? empresa).toString().replace(/[^\w-]+/g, "_")}-${periodo}.csv`;
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"` } });
}
