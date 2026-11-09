import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { zipSync, type Zippable } from "fflate";
import { ordenPdfBuffer } from "@/lib/pdf/orden-pdf.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { urlPublica } from "@/lib/supabase/config";
import { createClient, requireSesion } from "@/lib/supabase/server";
import type { VOcItem, VOrden } from "@/lib/types";

// Expediente por compra (pizarra "Cont. de Log."): comprobante, orden(es), guía, voucher,
// fotografías y contrato, en una carpeta por comprobante. Prod 1: la guía la registra Logística (tabla `guias`, no
// un adjunto). El ZIP de un periodo pesa más de lo que una respuesta del servidor permite: se guarda y se baja con un
// enlace de 2 minutos, como el Excel (bucket privado `exportes`).

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PREFIJO = { GUIA: "03-guia", VOUCHER: "04-voucher", FOTO: "05-foto", CONTRATO: "06-contrato" } as const;
const seguro = (s: string) => s.normalize("NFD").replace(/[^\w.-]+/g, "_");
const ext = (path: string) => path.split(".").pop()?.toLowerCase() ?? "bin";

async function descargar(supabase: Supabase, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`${path}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function agregarComprobante(supabase: Supabase, id: number, zip: Zippable) {
  const { data: c, error } = await supabase
    .from("v_comprobantes")
    .select("id, serie, numero, proveedor_ruc, archivo_path")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const carpeta = seguro(`${c.serie}-${c.numero}_${c.proveedor_ruc}`);
  const archivos: Zippable = {};

  if (c.archivo_path) archivos[`01-comprobante.${ext(c.archivo_path)}`] = await descargar(supabase, "comprobantes", c.archivo_path);

  // Órdenes cubiertas por el comprobante
  const { data: lineas, error: e2 } = await supabase.from("v_oc_items").select("obra_id, numero_oc").eq("comprobante_id", id);
  if (e2) throw new Error(e2.message);
  const ordenes = [...new Map(lineas.map((l) => [`${l.obra_id}|${l.numero_oc}`, l])).values()];
  for (const o of ordenes) {
    const [{ data: orden }, { data: items }] = await Promise.all([
      supabase.from("v_ordenes").select("*").eq("obra_id", o.obra_id!).eq("numero", o.numero_oc!).single(),
      supabase.from("v_oc_items").select("*").eq("obra_id", o.obra_id!).eq("numero_oc", o.numero_oc!).order("id"),
    ]);
    if (orden && items) {
      const pdf = await ordenPdfBuffer(orden as VOrden, items as VOcItem[]);
      archivos[`02-${orden.tipo}-${seguro(o.numero_oc!)}.pdf`] = new Uint8Array(pdf);
    }
  }

  // Guía de remisión registrada por Logística
  for (const o of ordenes) {
    const { data: guias, error: eg } = await supabase
      .from("guias")
      .select("id, numero_guia, archivo_path")
      .eq("obra_id", o.obra_id!)
      .eq("numero_oc", o.numero_oc!)
      .not("archivo_path", "is", null);
    if (eg) throw new Error(eg.message);
    for (const g of guias) {
      archivos[`${PREFIJO.GUIA}-${seguro(g.numero_guia ?? String(g.id))}.${ext(g.archivo_path!)}`] = await descargar(supabase, "documentos", g.archivo_path!);
    }
  }

  // Adjuntos de las órdenes (guía, fotos, contrato) y vouchers de los pagos aplicados
  const { data: aplic } = await supabase.from("pago_aplicaciones").select("pago_id").eq("comprobante_id", id);
  const pagoIds = [...new Set((aplic ?? []).map((a) => a.pago_id))];
  const filtros = [
    ...ordenes.map((o) => `and(obra_id.eq.${o.obra_id},numero_oc.eq."${String(o.numero_oc).replace(/"/g, "")}")`),
    ...(pagoIds.length ? [`pago_id.in.(${pagoIds.join(",")})`] : []),
  ];
  if (filtros.length) {
    const { data: adjuntos, error: e3 } = await supabase.from("adjuntos").select("id, tipo, nombre, path").or(filtros.join(","));
    if (e3) throw new Error(e3.message);
    for (const a of adjuntos) {
      archivos[`${PREFIJO[a.tipo]}-${a.id}-${seguro(a.nombre)}`] = await descargar(supabase, "documentos", a.path);
    }
  }

  // Fotos de las entregas de esas órdenes
  for (const o of ordenes) {
    const { data: fotos, error: e4 } = await supabase
      .from("entrega_fotos")
      .select("id, path, entregas!inner(obra_id, numero_oc)")
      .eq("entregas.obra_id", o.obra_id!)
      .eq("entregas.numero_oc", o.numero_oc!);
    if (e4) throw new Error(e4.message);
    for (const f of fotos) {
      archivos[`${PREFIJO.FOTO}-entrega-${f.id}.${ext(f.path)}`] = await descargar(supabase, "documentos", f.path);
    }
  }
  zip[carpeta] = archivos;
}

export async function GET(request: Request) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const url = new URL(request.url);
  const comprobante = Number(url.searchParams.get("comprobante"));
  const empresa = Number(url.searchParams.get("empresa"));
  const periodo = url.searchParams.get("periodo") ?? "";
  const supabase = await createClient();

  let ids: number[];
  let nombre: string;
  if (comprobante) {
    ids = [comprobante];
    nombre = `expediente-${comprobante}.zip`;
  } else if (empresa && /^\d{6}$/.test(periodo)) {
    const { data, error } = await supabase
      .from("v_registro_compras")
      .select("comprobante_id, empresa")
      .eq("empresa_id", empresa)
      .eq("periodo", periodo);
    if (error) return new Response(error.message, { status: 500 });
    // Solo los elegidos en la lista (filtrada) de Compras, si vienen.
    const elegidos = new Set((url.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0));
    ids = data.map((d) => d.comprobante_id).filter((id) => !elegidos.size || elegidos.has(id));
    nombre = `expedientes-${seguro(data[0]?.empresa ?? String(empresa))}-${periodo}.zip`;
  } else {
    return new Response("Parámetros inválidos", { status: 400 });
  }

  try {
    const zip: Zippable = {};
    for (const id of ids) await agregarComprobante(supabase, id, zip);
    // PDF e imágenes ya vienen comprimidos: se guardan sin recomprimir.
    const bytes = zipSync(zip, { level: 0 });
    const db = createAdminClient(sesion.userId);
    const ruta = `expedientes/${sesion.userId}.zip`;
    const { error: e1 } = await db.storage.from("exportes").upload(ruta, bytes, { upsert: true, contentType: "application/zip" });
    if (e1) throw new Error(e1.message);
    const { data: enlace, error: e2 } = await db.storage.from("exportes").createSignedUrl(ruta, 120, { download: nombre });
    if (e2 || !enlace) throw new Error(e2?.message ?? "No se pudo generar el enlace");
    return new Response(null, { status: 303, headers: { Location: urlPublica(enlace.signedUrl) } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "No se pudo generar el expediente", { status: 500 });
  }
}
