import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { VRegistroCompra } from "@/lib/types";

// SIRE, reemplazo de la propuesta del Registro de Compras Electrónico (libro 080400): 41 campos
// separados por "|" (Estructura del Reemplazo RCE, Anexo 1 R.S. 112-2021/SUNAT), UTF-8 y CRLF.
// Se sigue el TXT real que Contabilidad sube a SUNAT: vencimiento = emisión, clasificación de bienes
// y servicios "1", sin tipo de cambio en soles y los campos 34 a 41 vacíos.

const TIPOS = ["FACTURA", "BOLETA"] as const;
const TIPO_SUNAT: Record<(typeof TIPOS)[number], string> = { FACTURA: "01", BOLETA: "03" };

const n2 = (n: number) => Number(n).toFixed(2);
const ddmmyyyy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const limpio = (s: string) => s.replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim();

function linea(f: VRegistroCompra) {
  const ruc = f.proveedor_ruc.trim();
  // Factura con IGV: base e IGV según su destino (DGNG por defecto, o DNG). Sin IGV (exonerada,
  // inafecta o boleta): todo como adquisición no gravada. Lo que no cuadre con el total va a "otros".
  const conIgv = f.tipo === "FACTURA" && f.igv > 0;
  const dgng = conIgv && f.destino_igv !== "DNG";
  const dng = conIgv && f.destino_igv === "DNG";
  const ng = conIgv ? 0 : f.total;
  const otros = conIgv ? Math.round((f.total - f.base - f.igv) * 100) / 100 : 0;
  const campos = [
    f.empresa_ruc, // 1 RUC
    limpio(f.empresa), // 2 razón social
    f.periodo, // 3 periodo (AAAAMM)
    "", // 4 CAR SUNAT: vacío en el reemplazo
    ddmmyyyy(f.fecha_emision), // 5 fecha de emisión
    ddmmyyyy(f.fecha_emision), // 6 fecha de vencimiento o pago
    TIPO_SUNAT[f.tipo as (typeof TIPOS)[number]], // 7 tipo de comprobante (tabla 10)
    f.serie, // 8 serie
    "", // 9 año (DUA/DSI)
    f.numero, // 10 número
    "", // 11 número final (rango)
    ruc.length === 11 ? "6" : "1", // 12 tipo de documento de identidad (tabla 2)
    ruc, // 13 número de documento
    limpio(f.proveedor), // 14 razón social del proveedor
    "0.00", // 15 BI gravado DG
    "0.00", // 16 IGV DG
    n2(dgng ? f.base : 0), // 17 BI gravado DGNG
    n2(dgng ? f.igv : 0), // 18 IGV DGNG
    n2(dng ? f.base : 0), // 19 BI gravado DNG
    n2(dng ? f.igv : 0), // 20 IGV DNG
    n2(ng), // 21 valor adquisiciones no gravadas
    "0.00", // 22 ISC
    "0.00", // 23 ICBPER
    n2(otros), // 24 otros tributos y cargos
    n2(f.total), // 25 total
    "PEN", // 26 moneda
    "", // 27 tipo de cambio
    "", // 28 fecha del comprobante modificado
    "", // 29 tipo del comprobante modificado
    "", // 30 serie del comprobante modificado
    "", // 31 código DAM o DSI
    "", // 32 número del comprobante modificado
    "1", // 33 clasificación de bienes y servicios
    "", // 34 identificación del proyecto (operadores o partícipes)
    "", // 35 porcentaje de participación
    "", // 36 impuesto a los juegos (IMB)
    "", // 37 CAR original
    "", // 38–41 los completa SUNAT
    "",
    "",
    "",
  ];
  return `${campos.join("|")}|`;
}

export async function GET(request: Request) {
  await requireSesion(ROLES_CONTABILIDAD);
  const url = new URL(request.url);
  const empresa = Number(url.searchParams.get("empresa"));
  const periodo = url.searchParams.get("periodo") ?? "";
  if (!empresa || !/^\d{6}$/.test(periodo)) return new Response("Parámetros inválidos", { status: 400 });
  // Solo los comprobantes elegidos en la lista (filtrada) de Compras.
  const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (url.searchParams.has("ids") && !ids.length) return new Response("Parámetros inválidos", { status: 400 });

  const supabase = await createClient();
  let consulta = supabase
    .from("v_registro_compras")
    .select("*")
    .eq("empresa_id", empresa)
    .eq("periodo", periodo)
    .in("tipo", TIPOS)
    .order("fecha_emision")
    .order("comprobante_id");
  if (ids.length) consulta = consulta.in("comprobante_id", ids);
  const [{ data, error }, { data: emp }] = await Promise.all([
    consulta,
    supabase.from("empresas").select("ruc").eq("id", empresa).maybeSingle(),
  ]);
  if (error) return new Response(error.message, { status: 500 });

  const filas: VRegistroCompra[] = data;
  const ruc = emp?.ruc ?? "00000000000";
  // Como el archivo que sube Contabilidad: líneas con CRLF y sin salto al final.
  const texto = filas.map(linea).join("\r\n");
  // LE + RUC + AAAAMM00 + libro 080400 + oportunidad 02 + operación 1 + contenido (1 con datos, 0 vacío)
  // + moneda 1 (soles) + 2, como el nombre del archivo real.
  const nombre = `LE${ruc}${periodo}00080400021${filas.length ? "1" : "0"}12.txt`;

  return new Response(Buffer.from(texto, "utf8"), {
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}
