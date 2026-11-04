import { logoPdfEmpresa } from "@/lib/empresas";
import { contratoPdfBuffer } from "@/lib/pdf/contrato-pdf.server";
import { representanteContratos } from "@/lib/representante";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VOcItem, VOrden } from "@/lib/types";

// Archivos del link del proveedor, solo para ver: el voucher de uno de sus pagos o el contrato de su OS (el firmado
// si ya se subió; si no, el contrato para firmar). La base valida el token y su vigencia (archivo_link); el
// almacenamiento no se muestra. Desde el link no se sube nada.

const SIN_CACHE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const noDisponible = () => new Response("Este archivo ya no está disponible", { status: 404, headers: { ...SIN_CACHE, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(req: Request, { params }: RouteContext<"/cotizar/[token]/archivo">) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return noDisponible();
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") === "contrato" ? "CONTRATO" : url.searchParams.get("tipo") === "voucher" ? "VOUCHER" : null;
  const id = Number(url.searchParams.get("id") ?? 0);
  if (!tipo || (tipo === "VOUCHER" && !(id > 0))) return noDisponible();

  const db = createAdminClient();
  const { data, error } = await db.rpc("archivo_link", { p_token: token, p_tipo: tipo, p_id: id });
  const r = data as { obra_id: number; numero: string; tipo: string; path: string | null; con_contrato?: boolean } | null;
  if (error || !r) return noDisponible();
  // La base ya no admite rutas con «..» (path traversal); por si acaso, tampoco aquí.
  if (r.path && /\.\.|\/\/|\\|%/.test(r.path)) return noDisponible();

  if (r.path) {
    // En producción, a una URL firmada corta (Vercel no entrega respuestas de más de 4,5 MB); en local, el archivo.
    if (process.env.NEXT_PUBLIC_SUPABASE_DIRECTO === "1") {
      const { data: f } = await db.storage.from("documentos").createSignedUrl(r.path, 60);
      return f?.signedUrl ? Response.redirect(f.signedUrl, 302) : noDisponible();
    }
    const { data: archivo } = await db.storage.from("documentos").download(r.path);
    if (!archivo) return noDisponible();
    const mime = archivo.type || "application/octet-stream";
    const verEnLinea = mime === "application/pdf" || /^image\/(png|jpe?g|webp|gif)$/.test(mime);
    return new Response(archivo, {
      headers: {
        ...SIN_CACHE,
        "Content-Type": verEnLinea ? mime : "application/octet-stream",
        "Content-Disposition": `${verEnLinea ? "inline" : "attachment"}; filename="${r.path.split("/").pop()}"`,
      },
    });
  }

  // OS sin el contrato firmado: el contrato para firmar (solo las OS que llevan contrato).
  if (tipo !== "CONTRATO" || !r.con_contrato) return noDisponible();
  const [{ data: orden }, { data: items }, { data: oc }] = await Promise.all([
    db.from("v_ordenes").select("*").eq("obra_id", r.obra_id).eq("numero", r.numero).maybeSingle(),
    db.from("v_oc_items").select("*").eq("obra_id", r.obra_id).eq("numero_oc", r.numero).order("id"),
    db.from("ordenes_compra").select("comprobante_tipo, fecha_inicio").eq("obra_id", r.obra_id).eq("numero", r.numero).maybeSingle(),
  ]);
  if (!orden) return noDisponible();
  // Sin la imagen de la firma de Gerencia: el link lo ve cualquiera que lo tenga, y la firma va al firmar.
  const firmante = await representanteContratos(orden.empresa_id ?? null, { conFirma: false });
  const logo = logoPdfEmpresa(orden.empresa ?? "");
  const pdf = await contratoPdfBuffer(orden as VOrden, (items ?? []) as VOcItem[], {
    comprobante: (oc?.comprobante_tipo as "RXH" | "FACTURA" | null) ?? null,
    fechaInicio: oc?.fecha_inicio ?? null,
    ...firmante,
    logo: logo ? new URL(logo, url.origin).href : null,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...SIN_CACHE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Contrato-OS-${r.numero}.pdf"`,
    },
  });
}
