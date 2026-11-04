// Archivos de demostración: a todo comprobante sin archivo, a todo pago sin voucher y a toda OS ya
// enviada a Tesorería sin contrato firmado le genera una imagen marcada como SIMULADA, para que en
// la demo nada quede "por contabilizar" sin respaldo.
// Cada archivo generado se registra en la tabla datos_demo (tabla, registro_id, archivo): así se
// distinguen de los reales y se quitan al migrar los datos definitivos.
//
// Uso (después de db reset, demo-entregas y simular):  npm run db:demo-archivos
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/dist/compiled/@vercel/og/index.node.js");
const React = require("react");
const h = React.createElement;

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRETA = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !SECRETA) throw new Error("Faltan variables de Supabase en .env.local");
const admin = createClient(URL_SB, SECRETA, { auth: { persistSession: false } });

const ok = (r, ctx) => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};
const soles = (n) => `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (iso) => iso.slice(0, 10).split("-").reverse().join("/");
const TIPO = { FACTURA: "FACTURA ELECTRÓNICA", BOLETA: "BOLETA DE VENTA ELECTRÓNICA", RXH: "RECIBO POR HONORARIOS ELECTRÓNICO" };

async function png(el, ancho, alto) {
  const r = new ImageResponse(el, { width: ancho, height: alto });
  return Buffer.from(await r.arrayBuffer());
}

const sello = (texto) =>
  h(
    "div",
    {
      style: {
        position: "absolute", top: "42%", left: "8%", width: "84%", display: "flex", justifyContent: "center",
        border: "6px solid #c8231a", borderRadius: 12, padding: "10px 0", color: "#c8231a", fontSize: 32, fontWeight: 800,
        transform: "rotate(-12deg)", background: "rgba(255,255,255,0.75)",
      },
    },
    texto,
  );

const fila = (k, v, fuerte) =>
  h("div", { style: { display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e5df", padding: "10px 0", fontSize: 20 } },
    h("span", { style: { color: "#5f6762" } }, k), h("span", { style: { fontWeight: fuerte ? 800 : 600, maxWidth: 380, textAlign: "right" } }, v));

function comprobantePng(c) {
  return png(
    h(
      "div",
      { style: { width: 700, height: 900, display: "flex", flexDirection: "column", background: "white", padding: 44, fontFamily: "sans-serif", color: "#1a201d", position: "relative" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", gap: 20 } },
        h("div", { style: { display: "flex", flexDirection: "column", maxWidth: 360 } },
          h("div", { style: { display: "flex", fontSize: 24, fontWeight: 800 } }, c.proveedor.slice(0, 60)),
          h("div", { style: { display: "flex", fontSize: 18, color: "#5f6762", marginTop: 6 } }, `RUC ${c.ruc}`)),
        h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", border: "3px solid #1a201d", borderRadius: 10, padding: "12px 18px", width: 250 } },
          h("div", { style: { display: "flex", fontSize: 15, fontWeight: 800, textAlign: "center" } }, TIPO[c.tipo] ?? c.tipo),
          h("div", { style: { display: "flex", fontSize: 24, fontWeight: 800, marginTop: 6 } }, `${c.serie}-${c.numero}`))),
      h("div", { style: { display: "flex", flexDirection: "column", marginTop: 40 } },
        fila("Cliente", c.empresa),
        fila("RUC del cliente", c.empresaRuc ?? "—"),
        fila("Fecha de emisión", fmt(c.fecha))),
      h("div", { style: { display: "flex", flexDirection: "column", marginTop: "auto" } },
        ...(c.tipo === "FACTURA" ? [fila("Valor de venta", soles(c.base)), fila("IGV 18 %", soles(c.igv))] : []),
        ...(Number(c.retencion) > 0 ? [fila("Retención 4ta categoría", soles(c.retencion))] : []),
        fila("Importe total", soles(c.total), true)),
      sello("COMPROBANTE SIMULADO, NO VÁLIDO"),
    ),
    700,
    900,
  );
}

function voucherPng(p) {
  return png(
    h(
      "div",
      { style: { width: 600, height: 760, display: "flex", flexDirection: "column", background: "#f4f5f2", padding: 36, fontFamily: "sans-serif", color: "#1a201d", position: "relative" } },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", background: "white", borderRadius: 16, padding: 30, border: "2px solid #d7dbd5", flexGrow: 1 } },
        h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700 } }, p.banco || "Banco"),
        h("div", { style: { display: "flex", fontSize: 20, color: "#5f6762" } }, "Constancia de transferencia"),
        h("div", { style: { display: "flex", fontSize: 50, fontWeight: 700, marginTop: 30 } }, soles(p.monto)),
        h("div", { style: { display: "flex", flexDirection: "column", marginTop: 24 } },
          fila("Beneficiario", p.beneficiario.slice(0, 32)), fila("N° de operación", p.operacion || "—"), fila("Fecha", fmt(p.fecha))),
      ),
      sello("VOUCHER SIMULADO, NO VÁLIDO"),
    ),
    600,
    760,
  );
}

function contratoPng(o) {
  return png(
    h(
      "div",
      { style: { width: 700, height: 900, display: "flex", flexDirection: "column", background: "white", padding: 48, fontFamily: "sans-serif", color: "#1a201d", position: "relative" } },
      h("div", { style: { display: "flex", justifyContent: "center", fontSize: 26, fontWeight: 800 } }, "CONTRATO DE LOCACIÓN DE SERVICIOS"),
      h("div", { style: { display: "flex", justifyContent: "center", fontSize: 20, marginTop: 6 } }, `OS N° ${o.numero}`),
      h("div", { style: { display: "flex", flexDirection: "column", marginTop: 40 } },
        fila("Comitente", o.empresa), fila("Locador", o.proveedor.slice(0, 40)), fila("RUC / DNI", o.ruc ?? "—"), fila("Obra", o.obra), fila("Retribución (100 %)", soles(o.total), true)),
      h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 18 } },
        h("span", { style: { borderTop: "2px solid #1a201d", paddingTop: 6, width: 260, display: "flex", justifyContent: "center" } }, "EL COMITENTE"),
        h("span", { style: { borderTop: "2px solid #1a201d", paddingTop: 6, width: 260, display: "flex", justifyContent: "center" } }, "EL LOCADOR")),
      sello("CONTRATO SIMULADO, NO VÁLIDO"),
    ),
    700,
    900,
  );
}

async function todas(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const lote = ok(await consulta().range(desde, desde + 999), "consulta");
    filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
}

// Procesa en grupos pequeños: generar la imagen y subirla son lo lento.
async function enGrupos(lista, n, fn) {
  for (let i = 0; i < lista.length; i += n) await Promise.all(lista.slice(i, i + n).map(fn));
}

// ------------------------------------------------------------------ comprobantes
const [empresas, proveedores] = await Promise.all([
  todas(() => admin.from("empresas").select("id, nombre, ruc")),
  todas(() => admin.from("proveedores").select("id, razon_social, ruc_o_cod")),
]);
const empresa = new Map(empresas.map((e) => [e.id, e]));
const proveedor = new Map(proveedores.map((p) => [p.id, p]));

const sinArchivo = await todas(() => admin.from("comprobantes").select("*").is("archivo_path", null).order("id"));
let hechos = 0;
await enGrupos(sinArchivo, 6, async (c) => {
  const prov = proveedor.get(c.proveedor_id);
  const emp = empresa.get(c.empresa_id);
  const buffer = await comprobantePng({
    tipo: c.tipo, serie: c.serie, numero: c.numero, fecha: c.fecha_emision, total: c.total, base: c.base, igv: c.igv, retencion: c.retencion,
    proveedor: prov?.razon_social ?? "PROVEEDOR", ruc: prov?.ruc_o_cod ?? "—", empresa: emp?.nombre ?? "—", empresaRuc: emp?.ruc,
  });
  const path = `demo/${c.empresa_id}/${c.serie}-${c.numero}-${c.id}.png`;
  ok(await admin.storage.from("comprobantes").upload(path, buffer, { contentType: "image/png", upsert: true }), `subir ${path}`);
  ok(await admin.from("comprobantes").update({ archivo_path: path }).eq("id", c.id), `comprobante ${c.id}`);
  ok(await admin.from("datos_demo").upsert({ tabla: "comprobantes", registro_id: String(c.id), archivo: path }, { onConflict: "tabla,registro_id" }), "datos_demo");
  hechos++;
});
console.log(`Comprobantes con archivo simulado: ${hechos}`);

// ------------------------------------------------------------------ vouchers
const [pagos, vouchers, aplicaciones, comprobantes] = await Promise.all([
  todas(() => admin.from("pagos").select("id, fecha, banco, numero_operacion, monto").order("id")),
  todas(() => admin.from("adjuntos").select("pago_id").eq("tipo", "VOUCHER").not("pago_id", "is", null)),
  todas(() => admin.from("pago_aplicaciones").select("pago_id, comprobante_id, orden_pago_id")),
  todas(() => admin.from("comprobantes").select("id, proveedor_id")),
]);
const conVoucher = new Set(vouchers.map((v) => v.pago_id));
const provDeComprobante = new Map(comprobantes.map((c) => [c.id, c.proveedor_id]));
const beneficiario = new Map();
for (const a of aplicaciones) {
  if (beneficiario.has(a.pago_id)) continue;
  const prov = proveedor.get(provDeComprobante.get(a.comprobante_id));
  if (prov) beneficiario.set(a.pago_id, prov.razon_social);
}

hechos = 0;
await enGrupos(
  pagos.filter((p) => !conVoucher.has(p.id)),
  6,
  async (p) => {
    const buffer = await voucherPng({
      banco: p.banco, operacion: p.numero_operacion, monto: p.monto, fecha: p.fecha, beneficiario: beneficiario.get(p.id) ?? "—",
    });
    const path = `demo/vouchers/pago-${p.id}.png`;
    ok(await admin.storage.from("documentos").upload(path, buffer, { contentType: "image/png", upsert: true }), `subir ${path}`);
    const adj = ok(
      await admin.from("adjuntos").insert({ tipo: "VOUCHER", pago_id: p.id, path, nombre: `voucher-simulado-${p.id}.png`, mime: "image/png" }).select("id").single(),
      `voucher ${p.id}`,
    );
    ok(await admin.from("datos_demo").upsert({ tabla: "adjuntos", registro_id: String(adj.id), archivo: path }, { onConflict: "tabla,registro_id" }), "datos_demo");
    hechos++;
  },
);
console.log(`Pagos con voucher simulado: ${hechos}`);

// ------------------------------------------------------------------ contratos de OS
// Toda OS que ya pasó a Tesorería necesita su contrato firmado.
const [os, contratos] = await Promise.all([
  todas(() =>
    admin
      .from("v_ordenes")
      .select("obra_id, numero, obra, empresa, proveedor, proveedor_ruc, total")
      .eq("tipo", "OS")
      .in("estado", ["EN_TESORERIA", "PAGADA", "EN_ENTREGA", "RECIBIDA"]),
  ),
  todas(() => admin.from("adjuntos").select("obra_id, numero_oc").eq("tipo", "CONTRATO")),
]);
const conContrato = new Set(contratos.map((c) => `${c.obra_id}|${c.numero_oc}`));
hechos = 0;
await enGrupos(
  os.filter((o) => !conContrato.has(`${o.obra_id}|${o.numero}`)),
  6,
  async (o) => {
    const buffer = await contratoPng(o);
    const path = `${o.obra_id}/${o.numero}/CONTRATO/demo-contrato-firmado.png`;
    ok(await admin.storage.from("documentos").upload(path, buffer, { contentType: "image/png", upsert: true }), `subir ${path}`);
    const adj = ok(
      await admin.from("adjuntos").insert({ tipo: "CONTRATO", obra_id: o.obra_id, numero_oc: o.numero, path, nombre: "contrato-firmado-simulado.png", mime: "image/png" }).select("id").single(),
      `contrato ${o.numero}`,
    );
    ok(await admin.from("datos_demo").upsert({ tabla: "adjuntos", registro_id: String(adj.id), archivo: path }, { onConflict: "tabla,registro_id" }), "datos_demo");
    hechos++;
  },
);
console.log(`OS con contrato firmado simulado: ${hechos}`);
