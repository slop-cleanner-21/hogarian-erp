import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { codigoPorPorcentaje, erroresDetracciones, txtDetracciones, type DepositoDetraccion } from "@/lib/sunat";
import { createClient, requireSesion } from "@/lib/supabase/server";

// TXT del pago masivo de detracciones (SUNAT, por internet) de las detracciones elegidas, de una misma empresa.
//   ?ids=1,2&lote=260001&codigos=1:030,2:037   (sin código, el que corresponde a su porcentaje)

export async function GET(request: Request) {
  await requireSesion(ROLES_CONTABILIDAD);
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0);
  const lote = url.searchParams.get("lote") ?? "";
  const codigos = new Map(
    (url.searchParams.get("codigos") ?? "")
      .split(",")
      .map((p) => p.split(":"))
      .filter(([id, c]) => Number(id) > 0 && /^\d{3}$/.test(c ?? ""))
      .map(([id, c]) => [Number(id), c]),
  );
  if (!ids.length) return new Response("Elige las detracciones", { status: 400 });
  const supabase = await createClient();
  const { data: filas, error } = await supabase
    .from("v_detracciones")
    .select("comprobante_id, empresa_id, proveedor, proveedor_ruc, cuenta_detracciones, serie, numero, fecha_emision, total, detraccion")
    .in("comprobante_id", ids);
  if (error) return new Response(error.message, { status: 500 });
  const empresas = [...new Set(filas.map((f) => f.empresa_id))];
  if (empresas.length !== 1) return new Response("Las detracciones de un archivo deben ser de una misma empresa", { status: 400 });
  const { data: emp } = await supabase.from("empresas").select("ruc, razon_social, nombre").eq("id", empresas[0]!).single();
  const depositos: DepositoDetraccion[] = filas.map((f) => ({
    ruc: f.proveedor_ruc ?? "",
    proveedor: f.proveedor ?? "",
    cuenta: f.cuenta_detracciones,
    codigo: codigos.get(f.comprobante_id!) ?? codigoPorPorcentaje((Number(f.detraccion) / Number(f.total)) * 100),
    monto: Number(f.detraccion),
    periodo: (f.fecha_emision ?? "").slice(0, 7).replace("-", ""),
    serie: f.serie ?? "",
    numero: f.numero ?? "",
  }));
  const errores = erroresDetracciones(emp?.ruc ?? "", lote, depositos);
  if (errores.length) return new Response(`No se puede armar el archivo:\n- ${errores.join("\n- ")}`, { status: 400 });
  const txt = txtDetracciones({ ruc: emp!.ruc!, razonSocial: emp!.razon_social || emp!.nombre }, lote, depositos);
  return new Response(txt.contenido, {
    headers: { "Content-Type": "text/plain; charset=us-ascii", "Content-Disposition": `attachment; filename="${txt.nombre}"` },
  });
}
