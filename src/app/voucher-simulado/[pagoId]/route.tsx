import { ImageResponse } from "next/og";
import { fecha, money } from "@/lib/format";
import { createClient, requireSesion } from "@/lib/supabase/server";

// Imagen de un voucher SIMULADO para pagos sin voucher adjunto (p. ej. los importados del
// Excel). Muestra los datos reales del pago con un sello rojo: no es un comprobante válido.

const ANCHO = 600;
const ALTO = 820;

type Fila = [string, string];

export async function GET(_: Request, { params }: RouteContext<"/voucher-simulado/[pagoId]">) {
  await requireSesion(["TESORERIA", "CONTABILIDAD", "LOGISTICA"]);
  const id = Number((await params).pagoId);
  if (!Number.isInteger(id)) return new Response("No encontrado", { status: 404 });

  const supabase = await createClient();
  const { data: p } = await supabase
    .from("pagos")
    .select(
      `fecha, banco, numero_operacion, monto, empresas(nombre),
       pago_aplicaciones(comprobantes(proveedores(razon_social, proveedor_cuentas(cuenta_bancaria))),
                         ordenes_compra(proveedores(razon_social, proveedor_cuentas(cuenta_bancaria))),
                         ordenes_pago(proveedores(razon_social, proveedor_cuentas(cuenta_bancaria))))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return new Response("No encontrado", { status: 404 });

  type Prov = { razon_social: string; proveedor_cuentas: { cuenta_bancaria: string | null } | null } | null;
  type Ap = { comprobantes: { proveedores: Prov } | null; ordenes_compra: { proveedores: Prov } | null; ordenes_pago: { proveedores: Prov } | null };
  const ap = (p.pago_aplicaciones as unknown as Ap[])[0];
  const prov = ap?.comprobantes?.proveedores ?? ap?.ordenes_compra?.proveedores ?? ap?.ordenes_pago?.proveedores ?? null;
  const empresa = (p.empresas as unknown as { nombre: string } | null)?.nombre ?? "";

  const filas: Fila[] = [
    ["Ordenante", empresa],
    ["Beneficiario", prov?.razon_social ?? "—"],
    ["Cuenta destino", prov?.proveedor_cuentas?.cuenta_bancaria ?? "—"],
    ["N° de operación", p.numero_operacion ?? "—"],
    ["Fecha", fecha(p.fecha)],
  ];

  return new ImageResponse(
    (
      <div style={{ width: ANCHO, height: ALTO, display: "flex", flexDirection: "column", background: "#f4f5f2", padding: 40, fontFamily: "sans-serif", color: "#1a201d", position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 16, padding: 32, border: "2px solid #d7dbd5", flexGrow: 1 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{p.banco ?? "Banco"}</div>
          <div style={{ display: "flex", fontSize: 20, color: "#5f6762", marginTop: 4 }}>Constancia de transferencia</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
            <div style={{ display: "flex", fontSize: 18, color: "#5f6762" }}>Monto</div>
            <div style={{ display: "flex", fontSize: 54, fontWeight: 700 }}>S/ {money(Number(p.monto))}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
            {filas.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e5df", padding: "14px 0", fontSize: 20 }}>
                <span style={{ color: "#5f6762" }}>{k}</span>
                <span style={{ fontWeight: 600, maxWidth: 330, textAlign: "right" }}>{v}</span>
              </div>
            ))}
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
          <div style={{ display: "flex", fontSize: 50, fontWeight: 800 }}>VOUCHER SIMULADO</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>NO VÁLIDO</div>
        </div>
      </div>
    ),
    { width: ANCHO, height: ALTO, headers: { "Cache-Control": "private, max-age=300" } },
  );
}
