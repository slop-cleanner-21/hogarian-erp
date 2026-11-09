import { ImageResponse } from "next/og";
import { fecha, money } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { TIPO_COMPROBANTE_LABEL } from "@/lib/types";

// Imagen de un comprobante SIMULADO para los que no tienen archivo (p. ej. los importados del
// Excel). Muestra los datos reales del comprobante con un sello rojo: no es un documento válido.

const ANCHO = 600;
const ALTO = 820;

export async function GET(_: Request, { params }: RouteContext<"/comprobante-simulado/[comprobanteId]">) {
  await requireSesion(["TESORERIA", "CONTABILIDAD", "ASISTENTE_CONTABILIDAD", "LOGISTICA"]);
  const id = Number((await params).comprobanteId);
  if (!Number.isInteger(id)) return new Response("No encontrado", { status: 404 });

  const supabase = await createClient();
  const { data: c } = await supabase
    .from("v_comprobantes")
    .select("tipo, comprobante, fecha_emision, empresa, empresa_ruc, proveedor, proveedor_ruc, base, igv, retencion, total")
    .eq("id", id)
    .maybeSingle();
  if (!c) return new Response("No encontrado", { status: 404 });

  const montos: [string, number][] = [
    ...(Number(c.igv) > 0 ? ([["Valor de venta", Number(c.base)], ["IGV", Number(c.igv)]] as [string, number][]) : []),
    ...(Number(c.retencion) > 0 ? ([["Retención", -Number(c.retencion)]] as [string, number][]) : []),
  ];

  return new ImageResponse(
    (
      <div style={{ width: ANCHO, height: ALTO, display: "flex", flexDirection: "column", background: "#f4f5f2", padding: 40, fontFamily: "sans-serif", color: "#1a201d", position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 16, padding: 32, border: "2px solid #d7dbd5", flexGrow: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 300 }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>{c.proveedor ?? "—"}</div>
              <div style={{ display: "flex", fontSize: 17, color: "#5f6762", marginTop: 4 }}>RUC {c.proveedor_ruc ?? "—"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", border: "2px solid #1a201d", borderRadius: 8, padding: "8px 14px" }}>
              <div style={{ display: "flex", fontSize: 16, fontWeight: 700 }}>{(TIPO_COMPROBANTE_LABEL[c.tipo!] ?? "").toUpperCase()}</div>
              <div style={{ display: "flex", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{c.comprobante}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 34, fontSize: 18 }}>
            {[
              ["Adquirente", c.empresa ?? "—"],
              ["RUC", c.empresa_ruc ?? "—"],
              ["Fecha de emisión", fecha(c.fecha_emision)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e5df", padding: "12px 0" }}>
                <span style={{ color: "#5f6762" }}>{k}</span>
                <span style={{ fontWeight: 600, maxWidth: 320, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", fontSize: 18 }}>
            {montos.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ color: "#5f6762" }}>{k}</span>
                <span>S/ {money(v)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #1a201d", paddingTop: 12, marginTop: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>Total</span>
              <span style={{ fontSize: 34, fontWeight: 700 }}>S/ {money(Number(c.total))}</span>
            </div>
          </div>
        </div>
        {/* Sello: no es un comprobante real */}
        <div
          style={{
            position: "absolute",
            top: 330,
            left: 30,
            width: 540,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            border: "6px solid #c8231a",
            borderRadius: 12,
            padding: "14px 0",
            color: "#c8231a",
            transform: "rotate(-14deg)",
          }}
        >
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>COMPROBANTE SIMULADO</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>NO VÁLIDO</div>
        </div>
      </div>
    ),
    { width: ANCHO, height: ALTO, headers: { "Cache-Control": "private, max-age=300" } },
  );
}
