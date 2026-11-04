// Simulación de una obra completa: «RESIDENCIAL LOS ÁLAMOS».
//
// Recorre los flujos reales del ERP con los usuarios de cada rol (mismas funciones y permisos que
// la app): Gerencia crea la obra y arma y publica el presupuesto, el Jefe de Operaciones asigna al residente,
// Logística emite las órdenes (cotización por link o precios directos), el proveedor cotiza por el
// link, Contabilidad emite guías y contabiliza, Tesorería paga o rechaza, el residente registra
// las entregas con fotos y GPS, el Ingeniero de Operaciones pide un adicional, el Jefe lo revisa y
// Gerencia lo aprueba. La mano de obra va por su propio flujo: el residente registra el avance
// diario, Operaciones valoriza cada dos semanas (con la retención de cada ítem) y Logística crea
// la OS de cada valorización, que sigue a contrato, Tesorería y pago.
//
// La línea de tiempo cubre ~3 meses y medio, hasta hoy: las primeras etapas quedan cerradas de punta a punta y las
// siguientes en cada estado intermedio (como una obra en marcha). Las fotos de entregas son ilustraciones
// «FOTO DEMO» (scripts/lib/fotos-demo.mjs); vouchers, guías y contratos son
// imágenes PNG generadas y marcadas como SIMULADAS.
//
// Uso (con la base reseteada):  npm run db:simular
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { fotoDemoPng, grupoFoto } from "./lib/fotos-demo.mjs";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/dist/compiled/@vercel/og/index.node.js");
const React = require("react");
const h = React.createElement;

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRETA = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !ANON || !SECRETA) throw new Error("Faltan variables de Supabase en .env.local");

const OBRA = "RESIDENCIAL LOS ÁLAMOS";
const MODELO = "RAYMONDI"; // obra real de la que se toma la estructura del presupuesto
const ETAPAS = ["L0", "L1A", "L1B", "L2A", "L2B", "L3A", "L3B", "IS 1", "IE 1", "ACB 1"];
const UBICACION = { lat: -8.0921, lng: -79.0103 }; // Trujillo
const DIAS_ATRAS = 100;

// ------------------------------------------------------------------ utilidades
const admin = createClient(URL_SB, SECRETA, { auth: { persistSession: false } });
const anon = createClient(URL_SB, ANON, { auth: { persistSession: false } });

async function como(email) {
  const c = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "erp12345" });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

async function rpc(c, fn, args) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const ok = (r, ctx) => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};

// Aleatorio reproducible: la misma simulación siempre da los mismos datos.
let semilla = 20261028;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const entre = (a, b) => a + azar() * (b - a);
const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const T0 = new Date();
T0.setHours(10, 0, 0, 0);
T0.setDate(T0.getDate() - DIAS_ATRAS);
const dia = (n, hora = 10) => {
  const d = new Date(T0);
  d.setDate(d.getDate() + Math.round(n));
  d.setHours(hora, Math.floor(entre(0, 59)), 0, 0);
  return d;
};
const iso = (d) => d.toISOString();
const fechaISO = (d) => d.toISOString().slice(0, 10);
const fmt = (d) => d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });

// ------------------------------------------------------------------ imágenes simuladas (PNG)
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
        border: "6px solid #c8231a", borderRadius: 12, padding: "10px 0", color: "#c8231a", fontSize: 34, fontWeight: 800,
        transform: "rotate(-12deg)", background: "rgba(255,255,255,0.75)",
      },
    },
    texto,
  );

function voucher({ banco, operacion, monto, beneficiario, fecha }) {
  const fila = (k, v) =>
    h("div", { style: { display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e5df", padding: "12px 0", fontSize: 20 } },
      h("span", { style: { color: "#5f6762" } }, k), h("span", { style: { fontWeight: 600, maxWidth: 330, textAlign: "right" } }, v));
  return png(
    h(
      "div",
      { style: { width: 600, height: 760, display: "flex", flexDirection: "column", background: "#f4f5f2", padding: 36, fontFamily: "sans-serif", color: "#1a201d", position: "relative" } },
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", background: "white", borderRadius: 16, padding: 30, border: "2px solid #d7dbd5", flexGrow: 1 } },
        h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700 } }, banco),
        h("div", { style: { display: "flex", fontSize: 20, color: "#5f6762" } }, "Constancia de transferencia"),
        h("div", { style: { display: "flex", fontSize: 52, fontWeight: 700, marginTop: 30 } }, `S/ ${monto.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`),
        h("div", { style: { display: "flex", flexDirection: "column", marginTop: 24 } }, fila("Beneficiario", beneficiario.slice(0, 32)), fila("N° de operación", operacion), fila("Fecha", fmt(fecha))),
      ),
      sello("VOUCHER SIMULADO"),
    ),
    600,
    760,
  );
}

function guiaPng({ numero, oc, transportista, placa, fecha }) {
  return png(
    h(
      "div",
      { style: { width: 700, height: 500, display: "flex", flexDirection: "column", background: "white", padding: 40, fontFamily: "sans-serif", color: "#1a201d", border: "3px solid #1a201d", position: "relative" } },
      h("div", { style: { display: "flex", fontSize: 30, fontWeight: 800 } }, "GUÍA DE REMISIÓN ELECTRÓNICA"),
      h("div", { style: { display: "flex", fontSize: 26, marginTop: 6 } }, numero),
      h("div", { style: { display: "flex", flexDirection: "column", marginTop: 30, fontSize: 22, gap: 8 } },
        h("span", null, `Orden de compra ${oc}`), h("span", null, `Transportista: ${transportista}`), h("span", null, `Placa: ${placa}`), h("span", null, `Inicio del traslado: ${fmt(fecha)}`)),
      sello("GUÍA SIMULADA"),
    ),
    700,
    500,
  );
}

function contratoPng({ numero, proveedor, ruc, monto, fecha }) {
  return png(
    h(
      "div",
      { style: { width: 700, height: 900, display: "flex", flexDirection: "column", background: "white", padding: 48, fontFamily: "sans-serif", color: "#1a201d", position: "relative" } },
      h("div", { style: { display: "flex", justifyContent: "center", fontSize: 26, fontWeight: 800 } }, "CONTRATO DE LOCACIÓN DE SERVICIOS"),
      h("div", { style: { display: "flex", justifyContent: "center", fontSize: 20, marginTop: 6 } }, `OS N° ${numero}`),
      h("div", { style: { display: "flex", flexDirection: "column", marginTop: 40, fontSize: 20, gap: 10 } },
        h("span", null, `Locador: ${proveedor.slice(0, 45)}`), h("span", null, `RUC / DNI: ${ruc}`), h("span", null, `Retribución: S/ ${monto.toLocaleString("es-PE", { minimumFractionDigits: 2 })} (100 %)`), h("span", null, `Fecha: ${fmt(fecha)}`)),
      h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 18 } },
        h("span", { style: { borderTop: "2px solid #1a201d", paddingTop: 6, width: 260, display: "flex", justifyContent: "center" } }, "EL COMITENTE"),
        h("span", { style: { borderTop: "2px solid #1a201d", paddingTop: 6, width: 260, display: "flex", justifyContent: "center" } }, "EL LOCADOR")),
      sello("CONTRATO SIMULADO"),
    ),
    700,
    900,
  );
}

async function subir(c, path, buffer) {
  ok(await c.storage.from("documentos").upload(path, buffer, { contentType: "image/png", upsert: true }), `subir ${path}`);
  return path;
}

// ------------------------------------------------------------------ inicio
const ya = await admin.from("obras").select("id").eq("nombre", OBRA).maybeSingle();
if (ya.data) {
  console.log(`La obra ${OBRA} ya existe (id ${ya.data.id}). Resetea la base para volver a simular.`);
  process.exit(0);
}

const [gerencia, operaciones, logistica, contabilidad, tesoreria, residente, jefeOperaciones, rrhh] = await Promise.all(
  ["gerencia", "operaciones", "logistica", "contabilidad", "tesoreria", "residente", "jefeoperaciones", "rrhh"].map((r) => como(`${r}@erp.local`)),
);
const empresa = ok(await admin.from("empresas").select("id").eq("nombre", "HOGARIAN").single(), "empresa");

// ---------- 1. Gerencia crea la obra
const obraId = Number(await rpc(gerencia, "guardar_obra", { p_id: null, p_nombre: OBRA, p_empresa_id: empresa.id, p_direccion: "Av. Los Álamos 450, Urb. El Golf, Trujillo" }));
console.log(`Obra ${OBRA}: id ${obraId}`);

// ---------- 2. Operaciones arma el presupuesto (estructura tomada de una obra real) y lo publica
const modelo = ok(await admin.from("obras").select("id").eq("nombre", MODELO).single(), "obra modelo");
const base = ok(
  await admin.from("partidas").select("etapa, requerimiento, item_id, cantidad, pu, items(rubro, tipo_material, descripcion, unidad)").eq("obra_id", modelo.id).not("pu", "is", null).gt("cantidad", 0),
  "partidas modelo",
);
const partidasNuevas = [];
for (const etapa of ETAPAS) {
  const de = base.filter((p) => p.etapa === etapa && p.requerimiento === "REGULAR");
  const top = (rubro, n) =>
    de
      .filter((p) => (rubro === "MATERIAL" ? p.items.rubro === "MATERIAL" : p.items.rubro === rubro))
      .sort((a, b) => b.cantidad * b.pu - a.cantidad * a.pu)
      .slice(0, n);
  for (const p of [...top("MATERIAL", 6), ...top("MANO OBRA", 2), ...top("SUBCONTRATO", 1)]) {
    partidasNuevas.push({
      id: null,
      etapa,
      requerimiento: "REGULAR",
      item_id: p.item_id,
      cantidad: redondear(Number(p.cantidad) * 0.6, 2) || 1,
      pu: Number(p.pu),
    });
  }
}
await rpc(gerencia, "guardar_partidas", { p_obra_id: obraId, p_partidas: partidasNuevas, p_eliminar: [] });
await rpc(gerencia, "publicar_presupuesto", { p_obra_id: obraId });
ok(await admin.from("obras").update({ presupuesto_publicado_at: iso(dia(2)) }).eq("id", obraId), "fecha publicación");

// Operaciones asigna al residente; al ingeniero de Obras lo asigna Gerencia.
const personas = ok(await admin.from("personas").select("id").eq("user_id", "a0000000-0000-4000-8000-000000000005"), "personas");
for (const p of personas) await rpc(jefeOperaciones, "asignar_persona_obra", { p_obra_id: obraId, p_persona_id: p.id, p_asignar: true });
console.log(`Presupuesto: ${partidasNuevas.length} partidas en ${ETAPAS.length} etapas, publicado; residente e ingeniero asignados`);

// RRHH pide el alta de un segundo residente para la obra (queda por aprobar)
await rpc(rrhh, "solicitar_persona", {
  p_tipo: "ALTA", p_persona_id: null, p_motivo: `Segundo residente para ${OBRA}`,
  p_datos: { nombre: "MARÍA FERNANDA CASTRO LEÓN", dni: "46120378", cargo: "RESIDENTE", telefono: "944 210 778", correo: "" },
});

// ---------- datos de apoyo
const partidas = ok(
  await admin.from("partidas").select("id, etapa, item_id, cantidad, pu, items(descripcion, unidad, rubro, tipo_material, cuenta_contable)").eq("obra_id", obraId).order("id"),
  "partidas obra",
);
const itemIds = [...new Set(partidas.map((p) => p.item_id))];
// Proveedor habitual de cada ítem según las compras reales.
const historico = ok(
  await admin.from("v_oc_items_calc").select("item_id, proveedor_id").in("item_id", itemIds).not("proveedor_id", "is", null).limit(5000),
  "histórico",
);
const habitual = new Map();
for (const id of itemIds) {
  const conteo = new Map();
  for (const x of historico.filter((x) => x.item_id === id)) conteo.set(x.proveedor_id, (conteo.get(x.proveedor_id) ?? 0) + 1);
  const mejor = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0];
  if (mejor) habitual.set(id, mejor[0]);
}
const proveedores = new Map(ok(await admin.from("proveedores").select("id, razon_social, ruc_o_cod, cuenta:proveedor_cuentas(banco)"), "proveedores").map((p) => [p.id, p]));
const deRespaldo = { MATERIAL: [...proveedores.values()].find((p) => p.razon_social.startsWith("MATERIALES CUPISNIQUE"))?.id, SERVICIO: personaConMasOrdenes() };
// Persona natural con recibo por honorarios: la de más órdenes (sin su RUC en el código: es dato personal).
function personaConMasOrdenes() {
  const ordenes = new Map();
  for (const x of historico) ordenes.set(x.proveedor_id, (ordenes.get(x.proveedor_id) ?? 0) + 1);
  return [...proveedores.values()]
    .filter((p) => /^10/.test(p.ruc_o_cod ?? ""))
    .sort((a, b) => (ordenes.get(b.id) ?? 0) - (ordenes.get(a.id) ?? 0) || a.id - b.id)[0]?.id;
}
const transportistas = ok(await admin.from("transportistas").select("*"), "transportistas");

// Cuentas: los ítems sin cuenta reciben la de su grupo (como lo haría Contabilidad en la grilla).
const sinCuenta = partidas.filter((p) => !p.items.cuenta_contable);
const porCuenta = new Map();
for (const p of sinCuenta) {
  const c = p.items.rubro === "MATERIAL" ? "91220101" : "911220329";
  porCuenta.set(c, [...new Set([...(porCuenta.get(c) ?? []), p.item_id])]);
}
for (const [cuenta, ids] of porCuenta) await rpc(contabilidad, "asignar_cuenta_items", { p_ids: ids, p_cuenta: cuenta });

// ---------- 3. Órdenes por etapa: hasta dónde llega cada una en la línea de tiempo
// destino: hasta qué paso avanza la orden ("RECIBIDA" = flujo completo).
const PLAN = {
  L0: "RECIBIDA", L1A: "RECIBIDA", L1B: "RECIBIDA", L2A: "RECIBIDA",
  L2B: "EN_ENTREGA", L3A: "MIXTO", L3B: "COTIZADA", "IS 1": "LINK", "IE 1": null, "ACB 1": null,
};
const PASOS = ["EMITIDA", "PRECIOS_CONFIRMADOS", "FACTURADA", "EN_TESORERIA", "PAGADA", "EN_ENTREGA", "RECIBIDA"];
const llega = (destino, paso) => PASOS.indexOf(paso) <= PASOS.indexOf(destino);

let correlativo = 7100;
let operacion = 880100;
const resumen = [];

async function ajustarFechas(numero, fechas) {
  ok(await admin.from("ordenes_compra").update({ fecha: fechaISO(fechas.creada), created_at: iso(fechas.creada) }).eq("obra_id", obraId).eq("numero", numero), "fecha orden");
  if (fechas.cotEnviada)
    ok(await admin.from("ordenes_compra").update({ cotizacion_enviada_at: iso(fechas.cotEnviada), cotizacion_recibida_at: fechas.cotRecibida ? iso(fechas.cotRecibida) : null }).eq("obra_id", obraId).eq("numero", numero), "fecha cotización");
}

async function simularOrden({ tipo, lineas, proveedorId, destino, diaBase, opciones = {} }) {
  const prov = proveedores.get(proveedorId);
  // `opciones.numero`: OS de una valorización, ya creada con precios confirmados.
  const existente = opciones.numero ?? null;
  const numero = existente ?? String(await rpc(logistica, "siguiente_numero_oc", { p_obra_id: obraId }));
  // Normalmente se pide todo el saldo; algunas órdenes piden una parte (el resto queda pendiente).
  const items = lineas.map((p) => ({ partida_id: p.id, cantidad: redondear(Number(p.cantidad) * (opciones.parcial ?? 1), 2) }));
  if (!existente) await rpc(logistica, "crear_orden", { p_obra_id: obraId, p_numero: numero, p_proveedor_id: proveedorId, p_tipo: tipo, p_items: items });
  const esMaterialPesado = tipo === "OC" && lineas.some((p) => ["ACERO", "CEMENTO", "AGREGADOS"].includes(p.items.tipo_material));
  if (esMaterialPesado) await rpc(logistica, "set_requiere_guia", { p_obra_id: obraId, p_numero: numero, p_requiere: true });

  const f = { creada: dia(diaBase) };
  const fila = { numero, tipo, etapa: lineas[0].etapa, proveedor: prov.razon_social };
  resumen.push(fila);
  const ocItems = ok(await admin.from("v_oc_items").select("id, partida_id, cantidad, pu_partida, pu_max").eq("obra_id", obraId).eq("numero_oc", numero).order("id"), "líneas");

  // Precio que ofrece el proveedor: alrededor del presupuesto (OS casi siempre igual o menor).
  const precio = (l, i) => {
    const pu = Number(l.pu_partida);
    if (opciones.sobreprecio && i === 0) return redondear(Number(l.pu_max ?? pu) * 1.04);
    const factor = tipo === "OS" ? entre(0.93, 1.0) : entre(0.9, 1.05);
    // Hacia abajo: un centavo de más ya sería sobreprecio.
    return Math.floor(Math.min(pu * factor, Number(l.pu_max ?? pu)) * 100) / 100;
  };
  const precios = ocItems.map((l, i) => ({ item_id: l.id, pu: precio(l, i) }));

  // Cotización: por link (el proveedor la llena) o Logística pone los precios directamente.
  if (!existente && (destino === "LINK" || opciones.porLink)) {
    await rpc(logistica, "marcar_cotizacion_enviada", { p_obra_id: obraId, p_numero: numero });
    f.cotEnviada = dia(diaBase, 11);
    if (destino !== "LINK") {
      const { token_cotizacion } = ok(await logistica.from("ordenes_compra").select("token_cotizacion").eq("obra_id", obraId).eq("numero", numero).single(), "token");
      const cot = await rpc(anon, "get_cotizacion", { p_token: token_cotizacion });
      if (!cot.disponible) throw new Error(`Link no disponible para ${numero}`);
      await rpc(anon, "enviar_cotizacion", { p_token: token_cotizacion, p_precios: precios });
      f.cotRecibida = dia(diaBase + 1, 16);
    }
  }
  if (destino === "LINK") {
    await ajustarFechas(numero, f);
    fila.estado = "Cotizando (link enviado)";
    return fila;
  }
  // Sobreprecio: Logística lo aprueba explícitamente antes de confirmar.
  if (!existente) {
    await rpc(logistica, "guardar_precios", {
      p_obra_id: obraId, p_numero: numero,
      p_precios: precios.map((p, i) => ({ ...p, pu_aprobado: opciones.sobreprecio && i === 0 ? p.pu : null })),
    });
    if (destino === "COTIZADA_SIN_CONFIRMAR") {
      await ajustarFechas(numero, f);
      fila.estado = "Cotizando (precios cargados)";
      return fila;
    }
    await rpc(logistica, "confirmar_precios", { p_obra_id: obraId, p_numero: numero });
  }

  // Guía de remisión: Logística la pide y Contabilidad la emite (en SUNAT) con su PDF.
  if (esMaterialPesado) {
    const t = transportistas[Math.floor(entre(0, transportistas.length))];
    const modalidad = ["TERCERO", "PROVEEDOR", "TERCERO", "PROPIO"][Math.floor(entre(0, 4))];
    const detalle = ocItems.map((l) => {
      const p = lineas.find((x) => x.id === l.partida_id);
      return `${l.cantidad} ${p.items.unidad} ${p.items.descripcion}`;
    }).join("\n");
    const guiaId = Number(await rpc(logistica, "solicitar_guia", {
      p_obra_id: obraId, p_numero: numero,
      p_datos: { modalidad, transportista_id: modalidad === "TERCERO" ? t.id : null, punto_partida: `Almacén ${prov.razon_social.slice(0, 40)}, Trujillo`, punto_llegada: `Obra ${OBRA}, Av. Los Álamos 450, Trujillo`, placa: t.placa, licencia: t.licencia, detalle, fecha_traslado: fechaISO(dia(diaBase + 5)) },
    }));
    const fSol = dia(diaBase + 3);
    ok(await admin.from("guias").update({ solicitado_at: iso(fSol) }).eq("id", guiaId), "fecha guía");
    if (destino !== "COTIZADA") {
      const nGuia = `T001-${String(correlativo++).padStart(6, "0")}`;
      const path = await subir(contabilidad, `guias/${obraId}/${numero}/guia-${nGuia}.png`, await guiaPng({ numero: nGuia, oc: numero, transportista: t.razon_social, placa: t.placa, fecha: dia(diaBase + 5) }));
      await rpc(contabilidad, "emitir_guia", { p_id: guiaId, p_numero_guia: nGuia, p_archivo_path: path });
      ok(await admin.from("guias").update({ emitido_at: iso(dia(diaBase + 4)) }).eq("id", guiaId), "fecha emisión guía");
    }
  }
  if (destino === "COTIZADA") {
    await ajustarFechas(numero, f);
    fila.estado = esMaterialPesado ? "Por facturar (guía solicitada)" : "Por facturar";
    return fila;
  }

  // Comprobante: factura, o recibo por honorarios con retención si el proveedor es persona natural.
  const lin = ok(await admin.from("v_oc_items").select("id, parcial").eq("obra_id", obraId).eq("numero_oc", numero), "parciales");
  const total = redondear(lin.reduce((a, l) => a + Number(l.parcial), 0));
  const rxh = tipo === "OS" && prov.ruc_o_cod.startsWith("10");
  const fComp = dia(diaBase + 6);
  const comprobanteId = Number(await rpc(logistica, "registrar_comprobante", {
    p_proveedor_id: proveedorId, p_tipo: rxh ? "RXH" : "FACTURA", p_serie: rxh ? "E001" : "F001", p_numero: String(correlativo++),
    p_fecha: fechaISO(fComp), p_total: total, p_retencion: rxh && total > 1500 ? redondear(total * 0.08) : 0, p_archivo_path: null,
    p_item_ids: lin.map((l) => l.id),
  }));
  if (destino === "FACTURADA") {
    await ajustarFechas(numero, f);
    fila.estado = "Por enviar a Tesorería";
    return fila;
  }
  // OS: contrato por el 100 % enviado al proveedor y firmado antes de ir a Tesorería.
  if (tipo === "OS") {
    await rpc(logistica, "enviar_contrato", { p_obra_id: obraId, p_numero: numero });
    const path = await subir(logistica, `${obraId}/${numero}/CONTRATO/contrato-firmado.png`, await contratoPng({ numero, proveedor: prov.razon_social, ruc: prov.ruc_o_cod, monto: total, fecha: dia(diaBase + 5) }));
    ok(await logistica.from("adjuntos").insert({ tipo: "CONTRATO", obra_id: obraId, numero_oc: numero, path, nombre: "contrato-firmado.png", mime: "image/png" }), "contrato firmado");
  }
  await rpc(logistica, "enviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero });

  // Algunas vuelven: Tesorería rechaza y Logística corrige y reenvía.
  if (opciones.rechazo) {
    // Por datos o documentos: vuelve a Logística con su factura (prod 1).
    await rpc(tesoreria, "rechazar_documento", { p_obra_id: obraId, p_numero: numero, p_orden_pago_id: null, p_motivo: opciones.rechazo, p_correccion: "DATOS" });
    ok(await admin.from("rechazos").update({ created_at: iso(dia(diaBase + 7, 15)) }).eq("obra_id", obraId).eq("numero", numero), "fecha rechazo");
    if (opciones.quedaRechazada) {
      await ajustarFechas(numero, f);
      fila.estado = "Rechazada (por corregir, con su factura)";
      return fila;
    }
    const comp = ok(await admin.from("comprobantes").select("*").eq("id", comprobanteId).single(), "comprobante");
    await rpc(logistica, "editar_comprobante", {
      p_id: comprobanteId, p_tipo: comp.tipo, p_serie: comp.serie, p_numero: String(correlativo++), p_fecha: fechaISO(dia(diaBase + 8)),
      p_total: Number(comp.total), p_retencion: Number(comp.retencion), p_archivo_path: null, p_motivo: "El proveedor reemitió la factura",
    });
    ok(await admin.from("comprobantes_historial").update({ editado_at: iso(dia(diaBase + 8, 12)) }).eq("comprobante_id", comprobanteId), "fecha corrección");
    // Corregida: Logística la reenvía con lo que corrigió (sin volver a confirmar precios).
    await rpc(logistica, "reenviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero, p_nota: "El proveedor reemitió la factura" });
    ok(await admin.from("rechazos").update({ reenviado_at: iso(dia(diaBase + 8, 16)) }).eq("obra_id", obraId).eq("numero", numero), "fecha reenvío");
  }
  if (destino === "EN_TESORERIA") {
    await ajustarFechas(numero, f);
    fila.estado = "En Tesorería";
    return fila;
  }

  // Tesorería aprueba el pago con N° de operación y voucher.
  const doc = ok(await tesoreria.from("v_por_pagar").select("saldo").eq("obra_id", obraId).eq("numero", numero).single(), "saldo");
  const fPago = dia(diaBase + 8);
  const banco = prov.cuenta?.banco?.trim() || "BCP";
  const nOp = String(operacion++);
  const vPath = await subir(tesoreria, `pagos/${empresa.id}/${obraId}-${numero}/voucher-${nOp}.png`, await voucher({ banco, operacion: nOp, monto: Number(doc.saldo), beneficiario: prov.razon_social, fecha: fPago }));
  const pagoId = Number(await rpc(tesoreria, "pagar_documento", {
    p_obra_id: obraId, p_numero: numero, p_orden_pago_id: null, p_fecha: fechaISO(fPago), p_banco: banco,
    p_numero_operacion: nOp, p_monto: Number(doc.saldo), p_voucher_path: vPath, p_voucher_nombre: `voucher-${nOp}.png`,
  }));

  // Contabilidad registra el asiento del comprobante y del pago.
  if (llega(destino, "RECIBIDA") || destino === "EN_ENTREGA") {
    await rpc(contabilidad, "contabilizar_comprobante", { p_comprobante_id: comprobanteId });
    await rpc(contabilidad, "contabilizar_pago", { p_pago_id: pagoId });
  }
  if (destino === "PAGADA") {
    await ajustarFechas(numero, f);
    fila.estado = "Pagada (falta constancia)";
    return fila;
  }
  await rpc(logistica, "enviar_constancia", { p_obra_id: obraId, p_numero: numero });
  // La OS de una valorización queda recibida: su ejecución ya está en los avances del residente.
  if (existente) {
    await ajustarFechas(numero, f);
    fila.estado = "Recibida (valorización)";
    return fila;
  }

  // Entregas: el residente (cámara + GPS) y a veces Logística; varias por línea en días distintos.
  let n = 0;
  for (const l of ocItems) {
    const p = lineas.find((x) => x.id === l.partida_id);
    const total = Number(l.cantidad);
    const partes = destino === "RECIBIDA" ? (total > 10 ? [0.6, 0.4] : [1]) : [entre(0.3, 0.6)];
    let dEntrega = diaBase + 10;
    for (const parte of partes) {
      const cant = redondear(total * parte, 2);
      const restante = redondear(total - (ok(await admin.from("v_entregas_item").select("entregado").eq("oc_item_id", l.id).single(), "entregado").entregado ?? 0), 2);
      const cantidad = parte === partes.at(-1) && destino === "RECIBIDA" ? restante : Math.min(cant, restante);
      if (!(cantidad > 0)) continue;
      const fEnt = dia(dEntrega, 9 + Math.floor(entre(0, 7)));
      const quien = azar() < 0.8 ? { c: residente, rol: "RESIDENTE" } : { c: logistica, rol: "LOGISTICA" };
      const fotos = [];
      const nFotos = 1 + Math.floor(entre(0, 2));
      for (let k = 0; k < nFotos; k++) {
        fotos.push(await subir(quien.c, `entregas/${obraId}/${numero}/sim-${l.id}-${n}-${k}.png`, await fotoDemoPng({ grupo: grupoFoto(p.items.tipo_material, p.items.rubro), descripcion: p.items.descripcion, fecha: fEnt, variante: k, totalFotos: nFotos })));
      }
      const conGps = quien.rol === "RESIDENTE";
      const observacion = opciones.observacion && n === 0 ? opciones.observacion : null;
      const entregaId = Number(await rpc(quien.c, "registrar_entrega", {
        p_oc_item_id: l.id, p_cantidad: cantidad, p_fotos: fotos,
        p_lat: conGps ? UBICACION.lat + entre(-0.0003, 0.0003) : null, p_lng: conGps ? UBICACION.lng + entre(-0.0003, 0.0003) : null,
        p_precision: conGps ? redondear(entre(5, 18), 1) : null, p_capturado: iso(fEnt), p_observacion: observacion,
      }));
      ok(await admin.from("entregas").update({ created_at: iso(fEnt) }).eq("id", entregaId), "fecha entrega");
      dEntrega += entre(2, 5);
      n++;
    }
  }
  if (opciones.cerrarIncompleta) {
    await rpc(gerencia, "cerrar_entrega", { p_obra_id: obraId, p_numero: numero, p_motivo: "El proveedor no tiene stock del saldo; se pedirá a otro proveedor" });
    ok(await admin.from("ordenes_compra").update({ entrega_cerrada_at: iso(dia(diaBase + 16)) }).eq("obra_id", obraId).eq("numero", numero), "fecha cierre");
  }
  await ajustarFechas(numero, f);
  const final = ok(await admin.from("ordenes_compra").select("estado, entrega_cerrada_at").eq("obra_id", obraId).eq("numero", numero).single(), "estado");
  fila.estado = final.entrega_cerrada_at ? "Recibida (entrega cerrada incompleta)" : final.estado === "RECIBIDA" ? "Recibida" : "En entrega";
  return fila;
}

// Agrupa las partidas de una etapa en órdenes: materiales (OC) por proveedor habitual y servicios (OS).
// La mano de obra no: va por avances y valorizaciones (sección 3b).
function ordenesDeEtapa(etapa) {
  const de = partidas.filter((p) => p.etapa === etapa && p.items.rubro !== "MANO OBRA");
  const grupos = new Map();
  for (const p of de) {
    const tipo = p.items.rubro === "MATERIAL" ? "OC" : "OS";
    const prov = habitual.get(p.item_id) ?? (tipo === "OC" ? deRespaldo.MATERIAL : deRespaldo.SERVICIO);
    const k = `${tipo}|${prov}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  return [...grupos.entries()].map(([k, lineas]) => ({ tipo: k.split("|")[0], proveedorId: Number(k.split("|")[1]), lineas }));
}

const RECHAZOS = ["La factura no coincide con la cantidad de la orden", "Falta el contrato del servicio", "El RUC del comprobante no corresponde"];
let diaEtapa = 4;
let iRechazo = 0;
for (const etapa of ETAPAS) {
  const plan = PLAN[etapa];
  if (!plan) continue;
  const ordenes = ordenesDeEtapa(etapa);
  for (const [i, o] of ordenes.entries()) {
    let destino = plan;
    const opciones = { porLink: i % 2 === 0, sobreprecio: etapa === "L1B" && i === 0 };
    if (plan === "MIXTO") {
      // L3A: una de cada estado entre Tesorería y la entrega
      destino = ["EN_TESORERIA", "FACTURADA", "PAGADA", "EN_TESORERIA"][i % 4];
      if (destino === "FACTURADA") Object.assign(opciones, { rechazo: RECHAZOS[iRechazo++ % RECHAZOS.length], quedaRechazada: true }), (destino = "EN_TESORERIA");
    }
    if (plan === "COTIZADA" && i % 2 === 1) destino = "COTIZADA_SIN_CONFIRMAR";
    if (plan === "RECIBIDA" && i === 1 && etapa === "L1A") opciones.rechazo = RECHAZOS[iRechazo++ % RECHAZOS.length];
    if (plan === "EN_ENTREGA" && i === 0) opciones.parcial = 0.7;
    if (plan === "EN_ENTREGA" && i === 1) opciones.cerrarIncompleta = true;
    if (etapa === "L2A" && i === 0 && o.tipo === "OC") opciones.observacion = "Llegaron 3 bolsas rotas; el proveedor las repone en la siguiente entrega";
    await simularOrden({ ...o, destino, diaBase: diaEtapa + i * 1.5, opciones });
  }
  diaEtapa += plan === "RECIBIDA" ? 18 : 6;
}

// ---------- 3b. Mano de obra: avance diario del residente, valorización cada dos semanas y su OS
// Hasta dónde se ejecutó cada etapa (fracción de lo presupuestado).
const EJECUCION = { L0: 1, L1A: 1, L1B: 1, L2A: 1, L2B: 0.6, L3A: 0.25 };
const INICIO = { L0: 5, L1A: 20, L1B: 36, L2A: 52, L2B: 70, L3A: 89 };
const manoObra = partidas.filter((p) => p.items.rubro === "MANO OBRA" && EJECUCION[p.etapa]);
// Gerencia baja la retención de un ítem a 3 % (el resto queda en 5 %).
if (manoObra[0]) await rpc(gerencia, "guardar_retenciones", { p_obra_id: obraId, p_retenciones: [{ item_id: manoObra[0].item_id, porcentaje: 3 }] });
// Avances: 3 a 5 registros por partida, en días hábiles desde el inicio de su etapa.
const avances = [];
for (const p of manoObra) {
  const meta = redondear(Number(p.cantidad) * EJECUCION[p.etapa], 2);
  const n = 3 + Math.floor(entre(0, 3));
  let acumulado = 0;
  for (let k = 0; k < n; k++) {
    const cantidad = k === n - 1 ? redondear(meta - acumulado, 2) : redondear((meta / n) * entre(0.8, 1.2), 2);
    if (!(cantidad > 0)) continue;
    acumulado = redondear(acumulado + cantidad, 2);
    const d = Math.min(INICIO[p.etapa] + k * 3 + Math.floor(entre(0, 2)), DIAS_ATRAS - 1);
    avances.push({ p, cantidad, dia: d });
  }
}
avances.sort((a, b) => a.dia - b.dia);
const CORTES = [18, 32, 46, 60, 74, 88];
const valorizaciones = [];
let iAvance = 0;
let nAvance = 0;
async function registrarAvance({ p, cantidad, dia: d }, observacion = null) {
  const f = dia(d, 8 + Math.floor(entre(0, 8)));
  const fotos = [];
  const nFotos = 1 + Math.floor(entre(0, 2));
  for (let k = 0; k < nFotos; k++) {
    fotos.push(await subir(residente, `avances/${obraId}/sim-${p.id}-${nAvance}-${k}.png`, await fotoDemoPng({ grupo: grupoFoto(p.items.tipo_material, p.items.rubro), descripcion: p.items.descripcion, fecha: f, variante: k, totalFotos: nFotos })));
  }
  const id = Number(await rpc(residente, "registrar_avance", {
    p_partida_id: p.id, p_cantidad: cantidad, p_fecha: fechaISO(f), p_fotos: fotos, p_observacion: observacion,
    p_lat: UBICACION.lat + entre(-0.0003, 0.0003), p_lng: UBICACION.lng + entre(-0.0003, 0.0003), p_precision: redondear(entre(5, 18), 1), p_capturado: iso(f),
  }));
  ok(await admin.from("avances").update({ created_at: iso(f) }).eq("id", id), "fecha avance");
  nAvance++;
  return id;
}
for (const corte of CORTES) {
  const antes = iAvance;
  while (iAvance < avances.length && avances[iAvance].dia < corte) await registrarAvance(avances[iAvance++]);
  if (iAvance === antes) continue;
  const vid = Number(await rpc(operaciones, "valorizar", { p_obra_id: obraId }));
  ok(await admin.from("valorizaciones").update({ fecha_corte: iso(dia(corte, 17)), created_at: iso(dia(corte, 17)) }).eq("id", vid), "fecha corte");
  valorizaciones.push({ id: vid, corte });
}
// Lo de la última semana queda sin valorizar; Operaciones observa un registro (el residente lo rehace).
const pendientes = avances.slice(iAvance);
for (const [k, a] of pendientes.entries()) await registrarAvance(a, k === 1 ? "Se trabajó medio día por lluvia" : null);
const sinValorizar = ok(await admin.from("avances").select("id").eq("obra_id", obraId).eq("estado", "REGISTRADO").order("id"), "sin valorizar");
if (sinValorizar.length > 2) await rpc(operaciones, "observar_avance", { p_id: sinValorizar[0].id, p_texto: "Las fotos no muestran el tramo avanzado: vuelve a registrarlo con fotos del avance" });

// Logística crea la OS de cada valorización (menos la última, que espera) y la lleva hasta donde corresponde.
const beneficiario = habitual.get(manoObra[0]?.item_id) ?? deRespaldo.SERVICIO;
for (const [k, v] of valorizaciones.entries()) {
  if (k === valorizaciones.length - 1) continue;
  const numero = String(await rpc(logistica, "crear_orden_valorizacion", { p_valorizacion_id: v.id, p_numero: "", p_proveedor_id: beneficiario }));
  const lineasV = ok(await admin.from("valorizacion_partidas").select("partida_id").eq("valorizacion_id", v.id), "partidas valorización");
  const destino = k < valorizaciones.length - 2 ? "RECIBIDA" : "EN_TESORERIA";
  await simularOrden({
    tipo: "OS", lineas: partidas.filter((p) => lineasV.some((l) => l.partida_id === p.id)), proveedorId: beneficiario,
    destino, diaBase: v.corte + 1, opciones: { numero },
  });
}

// ---------- 4. Adicional: el Ingeniero de Operaciones lo pide, el Jefe lo revisa, Gerencia lo aprueba y Logística lo compra
const itemAdicional = ok(await admin.from("items").select("id, descripcion").eq("descripcion", "YESO 5 KG").single(), "ítem adicional");
const solicitudId = Number(await rpc(operaciones, "solicitar_adicional", {
  p_obra_id: obraId, p_motivo: "Resanes en muros del 2° piso no previstos",
  p_datos: { etapa: "L2A", requerimiento: "ADIC 1", item_id: itemAdicional.id, cantidad: 60, pu: 9.5 },
}));
await rpc(jefeOperaciones, "revisar_solicitud", { p_id: solicitudId, p_aprobar: true, p_comentario: "Metrado verificado en obra" });
await rpc(gerencia, "resolver_solicitud", { p_id: solicitudId, p_aprobar: true, p_respuesta: "Aprobado, comprar con el proveedor habitual" });
const partidaAdicional = ok(await admin.from("partidas").select("id, etapa, item_id, cantidad, pu, items(descripcion, unidad, rubro, tipo_material, cuenta_contable)").eq("obra_id", obraId).eq("item_id", itemAdicional.id).single(), "partida adicional");
if (!partidaAdicional.items.cuenta_contable) await rpc(contabilidad, "asignar_cuenta_items", { p_ids: [itemAdicional.id], p_cuenta: "91220101" });
await simularOrden({ tipo: "OC", lineas: [partidaAdicional], proveedorId: deRespaldo.MATERIAL, destino: "RECIBIDA", diaBase: 70 });
// Y una baja de partida pendiente (sin compras)
const sinCompras = partidas.find((p) => p.etapa === "ACB 1" && p.items.rubro === "MATERIAL");
if (sinCompras) await rpc(jefeOperaciones, "solicitar_baja_partida", { p_partida_id: sinCompras.id, p_motivo: "El acabado cambia por cerámico, se pedirá como adicional" });
// Baja parcial pendiente: lo que falta de una partida de L3B que se reduce.
const conSaldo = partidas.find((p) => p.etapa === "L3B" && p.items.rubro === "MATERIAL" && p.id !== sinCompras?.id);
if (conSaldo) {
  const { faltante } = ok(await admin.from("partidas").select("faltante").eq("id", conSaldo.id).single(), "faltante");
  if (Number(faltante) > 1)
    await rpc(jefeOperaciones, "solicitar_baja_partida", { p_partida_id: conSaldo.id, p_motivo: "Se redujo el área de la losa del 3er piso", p_cantidad: Math.floor(Number(faltante) / 2) });
}
// Adicional de mano de obra con sustento (lo pide el Ingeniero; queda por revisar del Jefe).
const itemMo = manoObra.find((p) => p.etapa === "L2B")?.items;
const partidaMo = manoObra.find((p) => p.etapa === "L2B");
if (partidaMo) {
  const idMo = Number(await rpc(operaciones, "solicitar_adicional", {
    p_obra_id: obraId, p_motivo: "Muro de contención adicional en el lindero posterior",
    p_datos: { etapa: "L2B", requerimiento: "ADIC 1", item_id: partidaMo.item_id, cantidad: redondear(Number(partidaMo.cantidad) * 0.2, 2), pu: Number(partidaMo.pu) },
  }));
  const path = await subir(operaciones, `solicitudes/${idMo}/sustento-metrado.png`, await fotoDemoPng({ grupo: grupoFoto(itemMo.tipo_material, itemMo.rubro), descripcion: `Sustento: ${itemMo.descripcion}`, fecha: dia(DIAS_ATRAS - 2), variante: 0, totalFotos: 1 }));
  await rpc(operaciones, "adjuntar_solicitud", { p_solicitud_id: idMo, p_archivos: [{ path, nombre: "sustento-metrado.png", mime: "image/png" }] });
}

// ---------- 5. Órdenes de pago (Contabilidad) y su pago (Tesorería)
const OPS = [
  { concepto: "Alquiler de andamios (mes 1)", monto: 1800, dia: 18, pagar: true },
  { concepto: "Alquiler de andamios (mes 2)", monto: 1800, dia: 48, pagar: true },
  { concepto: "Consumo de agua y luz de obra", monto: 640.5, dia: 72, pagar: true },
  { concepto: "Alquiler de andamios (mes 3)", monto: 1800, dia: 94, pagar: false },
  { concepto: "Movilidad del personal", monto: 420, dia: 96, rechazar: "Falta el sustento de la movilidad" },
];
const benef = deRespaldo.SERVICIO;
for (const op of OPS) {
  const numero = await rpc(contabilidad, "crear_orden_pago", { p_obra_id: obraId, p_proveedor_id: benef, p_concepto: op.concepto, p_monto: op.monto, p_fecha: fechaISO(dia(op.dia)), p_cuenta: "6329" });
  const { id } = ok(await admin.from("ordenes_pago").select("id").eq("obra_id", obraId).eq("numero", numero).single(), "op");
  await rpc(contabilidad, "enviar_op_a_tesoreria", { p_id: id });
  if (op.rechazar) {
    await rpc(tesoreria, "rechazar_documento", { p_obra_id: null, p_numero: null, p_orden_pago_id: id, p_motivo: op.rechazar });
  } else if (op.pagar) {
    const nOp = String(operacion++);
    const vPath = await subir(tesoreria, `pagos/${empresa.id}/op-${id}/voucher-${nOp}.png`, await voucher({ banco: "BBVA", operacion: nOp, monto: op.monto, beneficiario: proveedores.get(benef).razon_social, fecha: dia(op.dia + 2) }));
    const pagoId = Number(await rpc(tesoreria, "pagar_documento", { p_obra_id: null, p_numero: null, p_orden_pago_id: id, p_fecha: fechaISO(dia(op.dia + 2)), p_banco: "BBVA", p_numero_operacion: nOp, p_monto: op.monto, p_voucher_path: vPath, p_voucher_nombre: `voucher-${nOp}.png` }));
    await rpc(contabilidad, "contabilizar_pago", { p_pago_id: pagoId });
  }
  resumen.push({ numero, tipo: "OP", etapa: "—", proveedor: op.concepto, estado: op.rechazar ? "Rechazada (borrador)" : op.pagar ? "Pagada" : "En Tesorería" });
}

// ---------- 6. Avisos: los de hace más de una semana ya se leyeron
const limite = new Date();
limite.setDate(limite.getDate() - 7);
const recientes = new Set(resumen.filter((r) => /Tesorería|Rechazada|Cotizando|Por facturar|Pagada \(|Por enviar|En entrega/.test(r.estado)).map((r) => r.numero));
const avisos = ok(await admin.from("notificaciones").select("id, href").is("leida_at", null), "avisos");
const viejos = avisos.filter((a) => ![...recientes].some((n) => a.href?.endsWith(`/${n}`))).map((a) => a.id);
if (viejos.length) ok(await admin.from("notificaciones").update({ leida_at: iso(limite), push_enviado_at: iso(limite) }).in("id", viejos), "avisos leídos");

// ---------- resumen
const porEstado = resumen.reduce((m, r) => m.set(r.estado, (m.get(r.estado) ?? 0) + 1), new Map());
console.log(`\nÓrdenes simuladas: ${resumen.length}`);
for (const [e, n] of porEstado) console.log(`  ${String(n).padStart(3)}  ${e}`);
console.log("\nDetalle:");
for (const r of resumen) console.log(`  ${r.tipo} ${r.numero.padEnd(8)} ${r.etapa.padEnd(6)} ${r.estado.padEnd(34)} ${r.proveedor.slice(0, 40)}`);
