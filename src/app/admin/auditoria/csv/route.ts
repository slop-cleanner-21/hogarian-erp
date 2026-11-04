import { filtrosDe, reporteAuditoria } from "@/lib/auditoria-reporte";
import { requireSesion } from "@/lib/supabase/server";

const celda = (v: unknown) => {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Excel no la toma como fórmula (un correo de un intento fallido podría ser «=HYPERLINK(…)»).
  if (/^[-=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** La auditoría filtrada (hasta 10 000 filas) en CSV, para Excel (UTF-8 con BOM, separado por comas). */
export async function GET(req: Request) {
  await requireSesion(["ADMIN"]);
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = filtrosDe(sp);
  const filas = await reporteAuditoria(f, 10000);
  const cab = ["Fecha y hora", "Usuario", "Acción", "Qué", "Registro", "Cambios", "IP", "Dispositivo", "Detalle"];
  const lineas = filas.map((r) =>
    [
      new Date(r.fecha).toLocaleString("es-PE", { timeZone: "America/Lima" }),
      r.usuario,
      r.accion,
      r.objeto,
      r.registro,
      r.resumen,
      r.ip,
      r.dispositivo,
      r.detalle,
    ]
      .map(celda)
      .join(","),
  );
  const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  return new Response(`﻿${[cab.join(","), ...lineas].join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${f.vista}-${dia}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
