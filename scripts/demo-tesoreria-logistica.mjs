// Demo de Tesorería y Logística: una obra de HOGARIAN con una orden por cada caso posible del flujo, para
// revisarlos en la app sin buscarlos entre varias obras. Dos versiones (argumento `mvp` o `prod1`):
//   mvp    «DEMO TESORERÍA Y LOGÍSTICA (MVP)»: todo como en el MVP (Contabilidad emite la guía, entregas
//          con fotos y cantidades recibidas).
//   prod1  «DEMO TESORERÍA Y LOGÍSTICA (PROD 1)»: solo lo que se puede llenar en prod 1. Logística registra
//          la guía en un solo paso y antes de enviar a Tesorería (no hay caso «Falta guía» en Tesorería);
//          sin entregas ni fotos (la recepción aún no se define), así que no hay caso «recibida». Por eso
//          los números desde el 14 corren uno y desde el 20, dos.
// Sin pagos parciales en ninguna de las dos: prod 1 los bloquea (Tesorería paga siempre la orden completa).
//
// Como scripts/simular-obra.mjs, inicia sesión con cada rol y llama a las mismas funciones que la app:
// Gerencia arma y publica el presupuesto y marca las detracciones; Logística crea las órdenes, envía
// el link, confirma precios, registra comprobantes, sube el contrato, pide la guía, envía a Tesorería,
// envía la constancia, registra entregas y anula; el proveedor cotiza por el link (anónimo);
// Contabilidad emite la guía; Tesorería paga (con voucher) o rechaza. Los proveedores son ficticios
// (RUC 2099999xxxx / 1099999xxxx, «… DEMO»); comprobantes, vouchers, guías, contratos y fotos son
// imágenes PNG marcadas como SIMULADAS.
//
// Casos (una orden por caso; los números salen en orden: 100001 = caso 1 … 100024 = caso 24):
//   Logística (antes de Tesorería)
//    1  100001  OC emitida, link sin enviar
//    2  100002  OC con link enviado, el proveedor aún no cotiza
//    3  100003  OC con cotización recibida del proveedor
//    4  100004  OC con cotización recibida con sobreprecio por aprobar
//    5  100005  OC con precios confirmados, sin comprobante, ítem con detracción y total sobre el mínimo
//    6  100006  OC con precios confirmados, ítem con detracción y total bajo el mínimo (S/ 700)
//    7  100007  OS sin contrato firmado (contrato enviado, factura registrada): no puede ir a Tesorería
//    8  100008  OC facturada por enviar a Tesorería (prod 1: sin guía, pasó sola a Tesorería)
//    9  100009  OC que requiere guía: guía solicitada, sin emitir
//   Tesorería (por pagar)
//   10  100010  OC con factura
//   11  100011  OC con factura con detracción (5 %)
//   12  100012  OS de servicio con contrato y recibo por honorarios con retención de 4ta (8 %)
//   13  100013  OC con boleta
//   14  100014  OC que requiere guía no emitida («Falta guía»)
//   15  100015  OC que requiere guía ya emitida
//   16  100016  OC con 2 rechazos previos (sin anular y con factura nueva), de nuevo en Tesorería
//   17  100017  OS de subcontrato con contrato y factura (detracción 12 %)
//   Después de Tesorería
//   18  100018  OC pagada, constancia por enviar
//   19  100019  OC en entrega: constancia enviada y una entrega parcial
//   20  100020  OC recibida: todo entregado
//   21  100021  OC rechazada por la factura: en «Facturar» (factura anulada), esperando la nueva
//   22  100022  OC rechazada por datos: con su factura, por corregir y reenviar
//   23  100023  OC anulada
//   Mano de obra (prod 1: Logística crea la OS directo, como un subcontrato, sin valorizaciones)
//   24  100024  OS de mano de obra emitida, contrato por enviar
//   25  100025  OS de mano de obra con contrato y recibo por honorarios (retención 8 %) en Tesorería
//   26  100026  OS de mano de obra con contrato y factura en Tesorería
//   27  100027  OS de mano de obra pagada
//   28  100028  OS de mano de obra rechazada por los precios: en cotización
//
// Idempotente: si la obra ya existe no hace nada (se puede correr después de cada `db reset`).
// Uso:  ERP_PASS=<clave de los usuarios de prueba> npm run db:demo-tesoreria   (arma las dos)
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
const CLAVE = process.env.ERP_PASS;
if (!URL_SB || !ANON || !SECRETA) throw new Error("Faltan variables de Supabase en .env.local");

const PROD1 = process.argv[2] === "prod1";
const OBRA = PROD1 ? "DEMO TESORERÍA Y LOGÍSTICA (PROD 1)" : "DEMO TESORERÍA Y LOGÍSTICA (MVP)";
// Series y N° distintos por versión: los comprobantes de un proveedor no se repiten entre las dos obras.
const SERIE = PROD1 ? "002" : "001";
const EMPRESA = "HOGARIAN";
const DIRECCION = "Calle Los Laureles 215, Urb. California, Trujillo";

// ------------------------------------------------------------------ utilidades
const admin = createClient(URL_SB, SECRETA, { auth: { persistSession: false } });
const anon = createClient(URL_SB, ANON, { auth: { persistSession: false } });

async function como(email) {
  const c = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: CLAVE });
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

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const hace = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
};
const fechaISO = (d) => d.toISOString().slice(0, 10);
const fmt = (d) => d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
const soles = (n) => `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/** Documento simple: título, subtítulo y filas «clave: valor», con el sello de SIMULADO. */
function documentoPng({ titulo, subtitulo, filas, marca, ancho = 700, alto = 600 }) {
  return png(
    h(
      "div",
      { style: { width: ancho, height: alto, display: "flex", flexDirection: "column", background: "white", padding: 40, fontFamily: "sans-serif", color: "#1a201d", border: "3px solid #1a201d", position: "relative" } },
      h("div", { style: { display: "flex", fontSize: 28, fontWeight: 800 } }, titulo),
      h("div", { style: { display: "flex", fontSize: 24, marginTop: 6 } }, subtitulo),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", marginTop: 30, fontSize: 21, gap: 8 } },
        ...filas.map(([k, v]) => h("span", null, `${k}: ${v}`)),
      ),
      sello(marca),
    ),
    ancho,
    alto,
  );
}

async function subir(c, bucket, path, buffer) {
  ok(await c.storage.from(bucket).upload(path, buffer, { contentType: "image/png", upsert: true }), `subir ${path}`);
  return path;
}

// ------------------------------------------------------------------ inicio
const ya = await admin.from("obras").select("id").eq("nombre", OBRA).maybeSingle();
if (ya.data) {
  console.log(`La obra ${OBRA} ya existe (id ${ya.data.id}): no se hace nada. Resetea la base para volver a crearla.`);
  process.exit(0);
}
if (!CLAVE) {
  console.error("Define ERP_PASS con la clave de los usuarios de prueba.");
  process.exit(1);
}

const [gerencia, logistica, contabilidad, tesoreria] = await Promise.all(
  ["gerencia", "logistica", "contabilidad", "tesoreria"].map((r) => como(`${r}@erp.local`)),
);
const empresa = ok(await admin.from("empresas").select("id, nombre").eq("nombre", EMPRESA).single(), "empresa");
const transportista = ok(await admin.from("transportistas").select("*").order("id").limit(1).single(), "transportista");

// ---------- Proveedores de demo (Logística los registra con su cuenta bancaria, como en la ficha)
const PROVEEDORES = {
  ferreteria: { ruc: "20999990011", razon: "FERRETERÍA EL PROGRESO DEMO SAC", comp: "FACTURA", banco: "BCP", cuenta: "570-9990011-0-11" },
  agregados: { ruc: "20999990022", razon: "AGREGADOS DEL NORTE DEMO SAC", comp: "FACTURA", banco: "BBVA", cuenta: "0011-0999-0200999022" },
  sanitarios: { ruc: "20999990033", razon: "SANITARIOS Y ACABADOS DEMO SAC", comp: "FACTURA", banco: "INTERBANK", cuenta: "620-3009999033" },
  electro: { ruc: "20999990044", razon: "ELECTRO INSTALACIONES DEMO SAC", comp: "FACTURA", banco: "SCOTIABANK", cuenta: "000-9990044" },
  tierras: { ruc: "20999990055", razon: "MOVIMIENTO DE TIERRAS DEMO SAC", comp: "FACTURA", banco: "BCP", cuenta: "570-9990055-0-55" },
  locador: { ruc: "10999990066", razon: "MENDOZA RÍOS JORGE LUIS (DEMO)", comp: "RXH", banco: "BANCO DE LA NACIÓN", cuenta: "04-999-990066" },
  bazar: { ruc: "20999990077", razon: "DISTRIBUIDORA EL AHORRO DEMO SAC", comp: "BOLETA", banco: "BCP", cuenta: "570-9990077-0-77" },
  // Mano de obra: un maestro de obra (persona natural, recibo por honorarios) y una contratista.
  maestro: { ruc: "10999990088", razon: "CASTILLO VEGA PEDRO (DEMO)", comp: "RXH", banco: "BCP", cuenta: "570-9990088-0-88" },
  contratista: { ruc: "20999990099", razon: "CONSTRUCCIONES LA UNIÓN DEMO SAC", comp: "FACTURA", banco: "INTERBANK", cuenta: "620-3009999099" },
};
for (const p of Object.values(PROVEEDORES)) {
  const existe = ok(await logistica.from("proveedores").select("id").eq("ruc_o_cod", p.ruc).maybeSingle(), `proveedor ${p.ruc}`);
  p.id = existe?.id ?? ok(
    await logistica.from("proveedores").insert({ ruc_o_cod: p.ruc, razon_social: p.razon, comprobante_habitual: p.comp }).select("id").single(),
    `proveedor ${p.ruc}`,
  ).id;
  ok(await logistica.from("proveedor_cuentas").upsert({ proveedor_id: p.id, banco: p.banco, cuenta_bancaria: p.cuenta }), `cuenta ${p.ruc}`);
}

// ---------- Gerencia crea la obra, arma el presupuesto (ítems existentes, etapas reales) y lo publica
const PARTIDAS = {
  cemento: ["L0", "CEMENTO TIPO I", 1500, 30.9],
  acero58: ["L0", "ACERO DE 5/8''", 500, 52],
  acero12: ["L0", "ACERO DE 1/2''", 300, 33.8],
  acero6: ["L0", "ACERO DE 6 MM", 800, 7.6],
  alambre16: ["L0", "ALAMBRE RECOCIDO N°16", 300, 4.4],
  antisalitre: ["L0", "CEMENTO ANTISALITRE TIPO MS", 300, 32.8],
  arenaFina: ["L0", "ARENA FINA", 100, 32.3],
  prestamo: ["L0", "MATERIAL DE PRESTAMO", 200, 30],
  hormigon: ["L0", "HORMIGON", 200, 35],
  gravilla: ["L0", 'GRAVILLA DE 1/2"', 120, 40],
  arena: ["L0", "ARENA GRUESA", 120, 35],
  tubo: ["L0", 'TUBO PVC SAL 4"', 60, 20],
  pegamento: ["L0", "PEGAMENTO PARA PVC 1/4 GAL", 20, 38],
  desmonte: ["L0", "ELIMINACIÓN DE DESMONTE C/MAQUINARIA", 300, 25],
  cuadrilla: ["L0", "CUADRILLA PARA VACIADO DE CONCRETO", 6, 1000],
  bloque: ["L1A", "BLOQUE DE CONCRETO Nº 14", 7000, 2.2],
  alambre: ["L1A", "ALAMBRE RECOCIDO N°8", 200, 4.5],
  disco: ["L1A", 'DISCO DE CORTE DE CONCRETO 7"', 30, 18],
  clavos: ["L1A", 'CLAVOS PARA MADERA DE 2"-4"', 120, 5],
  rapimix: ["L1A", "RAPIMIX MONTERO PARA ASENTADO", 400, 9.5],
  inodoro: ["IS 1", "INODORO + TANQUE BLANCO", 10, 205],
  lavatorio: ["IS 1", "LAVATORIO DE CERAMICA", 10, 60],
  lavaplatos: ["IS 1", "LAVAPLATOS DE ACERO INOXIDABLE DE 01 POZA", 10, 43],
  ducha: ["IS 1", "LLAVE CROMADA DUCHA", 10, 22.5],
  soportes: ["IS 1", "SOPORTES LAVAPLATOS LAVAROPA", 20, 15.9],
  lavaropa: ["IS 1", "LAVAROPA DE FIBRA DE VIDRIO", 10, 65],
  teflon: ["IS 1", "TEFLON", 200, 1],
  unas: ["IS 1", "UÑAS PARA LAVATORIO", 20, 7],
  pernos: ["IS 1", "PERNOS ANCL PISO", 40, 2],
  desague: ["IS 1", "DESAGÜE DE LAVAPLATOS", 20, 7],
  duchaPl: ["IS 1", "DUCHA PLASTICA", 20, 5],
  cuello: ["IS 1", "CUELLO DE CERA PARA INODORO", 20, 5],
  cable: ["IE 1", "CABLE FILAMENTADO N°14 THW", 60, 80],
  termo: ["IE 1", "LLAVE TERMOMAGNETICA 15A", 30, 12],
  toma: ["IE 1", "TOMACORRIENTE DOBLE CON PUESTA A TIERRA", 60, 5.5],
  conexion: ["IE 1", "CONEXIÓN A RED PUBLICA ELECTRICA", 1, 300],
  termo20: ["IE 1", "LLAVE TERMOMAGNETICA 20A", 40, 12.8],
  interruptor: ["IE 1", "INTERRUPTOR SIMPLE INCL PERNOS", 80, 3.3],
  interruptor2: ["IE 1", "INTERRUPTOR DOBLE INCL PERNOS", 60, 6],
  cinta: ["IE 1", "CINTA AISLANTE GRANDE", 60, 5.2],
  cajaRect: ["IE 1", "CAJA RECTANGULAR", 200, 0.9],
  subtablero: ["IE 1", "SUB TABLERO STD - 1", 10, 13],
  cajaPaso: ["IE 1", "CAJAS DE PASO 10 X 10", 40, 6],
  octogonal: ["IE 1", "CAJA OCTOGONAL PVC SEL", 120, 1.2],
  socate: ["IE 1", "SOCATE INCL PERNOS", 80, 3],
  // Mano de obra (5.º valor: el ítem es del rubro MANO OBRA), en las etapas que usan las obras reales.
  moBloque: ["L1A", "ASENTADO DE BLOQUE 14 EN 1ER NIVEL", 7000, 1.46, true],
  moTarrajeo: ["L2A", "TARRAJEO EN MUROS DE BAÑO", 80, 13.33, true],
  moInodoro: ["IS 1", "COLOCACION DE INODORO (Incluye Conexiones)", 10, 29.23, true],
  moDucha: ["IS 2", "COLOCACION DE DUCHA (Incluye Conexiones y griferia)", 10, 29.21, true],
  moLavamanos: ["IS 4", "COLOCACION DE LAVAMANOS (Incluye Conexiones y griferia)", 10, 29.21, true],
  moCableado: ["IE 1", "CABLEADO E INSTALACION DE ACCESORIOS ELECTRICOS", 10, 150, true],
  moVereda: ["ACB 1", 'VACIADO DE VEREDA E= 4" (INCL BRUÑADO)', 200, 14.67, true],
  moEnchape: ["ACB 1", "ENCHAPE DE PISOS CON CERAMICA", 60, 15.87, true],
};
// Detracciones que marca Gerencia: un material al 5 % y un subcontrato al 12 %.
const DETRACCIONES = { hormigon: 5, desmonte: 12 };

// Por descripción (las comillas de 1/2" no van bien en un filtro `in`): se traen y se buscan aquí.
// Mano de obra aparte: hay descripciones que se repiten entre rubros.
const items = ok(await admin.from("items").select("id, descripcion").neq("rubro", "MANO OBRA").order("id"), "ítems");
const itemsMO = ok(await admin.from("items").select("id, descripcion").eq("rubro", "MANO OBRA").order("id"), "ítems de mano de obra");
const itemDe = (descripcion, manoObra = false) => {
  const i = (manoObra ? itemsMO : items).find((x) => x.descripcion === descripcion);
  if (!i) throw new Error(`No existe el ítem «${descripcion}»`);
  return i.id;
};

const obraId = Number(await rpc(gerencia, "guardar_obra", { p_id: null, p_nombre: OBRA, p_empresa_id: empresa.id, p_direccion: DIRECCION }));
console.log(`Obra ${OBRA}: id ${obraId}`);
await rpc(gerencia, "guardar_partidas", {
  p_obra_id: obraId,
  p_partidas: Object.values(PARTIDAS).map(([etapa, descripcion, cantidad, pu, mo]) => ({ id: null, etapa, requerimiento: "REGULAR", item_id: itemDe(descripcion, mo), cantidad, pu })),
  p_eliminar: [],
});
await rpc(gerencia, "guardar_detracciones", {
  p_obra_id: obraId,
  p_detracciones: Object.entries(DETRACCIONES).map(([k, porcentaje]) => ({ item_id: itemDe(PARTIDAS[k][1]), porcentaje })),
});
await rpc(gerencia, "publicar_presupuesto", { p_obra_id: obraId });
const partidas = ok(
  await admin.from("partidas").select("id, etapa, item_id, items(descripcion, unidad, rubro, tipo_material)").eq("obra_id", obraId),
  "partidas",
);
const partida = (k) => partidas.find((p) => p.etapa === PARTIDAS[k][0] && p.item_id === itemDe(PARTIDAS[k][1], PARTIDAS[k][4]));
console.log(`Presupuesto: ${partidas.length} partidas publicadas; detracción en ${Object.entries(DETRACCIONES).map(([k, p]) => `${PARTIDAS[k][1]} (${p} %)`).join(" y ")}`);

// ------------------------------------------------------------------ pasos de una orden
let correlativo = 1;
let operacion = PROD1 ? 9908001 : 9907001;

const lineasDe = async (numero) =>
  ok(await admin.from("v_oc_items").select("id, partida_id, cantidad, pu_partida, pu_max, parcial, comprobante_id").eq("obra_id", obraId).eq("numero_oc", numero).order("id"), `líneas ${numero}`);

async function crear(tipo, prov, pedido) {
  const numero = String(await rpc(logistica, "siguiente_numero_oc", { p_obra_id: obraId }));
  await rpc(logistica, "crear_orden", {
    p_obra_id: obraId, p_numero: numero, p_proveedor_id: PROVEEDORES[prov].id, p_tipo: tipo,
    p_items: Object.entries(pedido).map(([k, cantidad]) => ({ partida_id: partida(k).id, cantidad })),
  });
  return numero;
}

const enviarLink = (numero) => rpc(logistica, "marcar_cotizacion_enviada", { p_obra_id: obraId, p_numero: numero });

/** El proveedor abre el link y envía sus precios (`factor` sobre el P.U. del presupuesto, por línea). */
async function cotizar(numero, factor = () => 0.98) {
  const { token_cotizacion } = ok(await logistica.from("ordenes_compra").select("token_cotizacion").eq("obra_id", obraId).eq("numero", numero).single(), "token");
  const cot = await rpc(anon, "get_cotizacion", { p_token: token_cotizacion });
  if (!cot.disponible) throw new Error(`El link de la ${numero} no está disponible`);
  const lineas = await lineasDe(numero);
  await rpc(anon, "enviar_cotizacion", {
    p_token: token_cotizacion,
    p_precios: lineas.map((l, i) => ({ item_id: l.id, pu: Math.floor(Number(l.pu_partida) * factor(i) * 100) / 100 })),
  });
}

/** Logística pone los precios (si no vinieron por el link) y los confirma. */
async function confirmar(numero, { precios = false } = {}) {
  if (precios) {
    const lineas = await lineasDe(numero);
    await rpc(logistica, "guardar_precios", { p_obra_id: obraId, p_numero: numero, p_precios: lineas.map((l) => ({ item_id: l.id, pu: Number(l.pu_partida) })) });
  }
  await rpc(logistica, "confirmar_precios", { p_obra_id: obraId, p_numero: numero });
  await siLista(numero);
}

/** Comprobante de todas las líneas sin comprobante, con su archivo simulado. */
async function facturar(numero, prov, tipo = "FACTURA", { diasAtras = 2 } = {}) {
  const p = PROVEEDORES[prov];
  const lineas = (await lineasDe(numero)).filter((l) => !l.comprobante_id);
  const total = redondear(lineas.reduce((a, l) => a + Number(l.parcial), 0));
  const retencion = tipo === "RXH" && total > 1500 ? redondear(total * 0.08) : 0;
  const serie = { FACTURA: "F", BOLETA: "B", RXH: "E" }[tipo] + SERIE;
  const num = String(correlativo++);
  const fecha = hace(diasAtras);
  const titulo = { FACTURA: "FACTURA ELECTRÓNICA", BOLETA: "BOLETA DE VENTA ELECTRÓNICA", RXH: "RECIBO POR HONORARIOS ELECTRÓNICO" }[tipo];
  const archivo = await subir(logistica, "comprobantes", `${empresa.id}/${p.ruc}/${serie}-${num}-demo.png`, await documentoPng({
    titulo, subtitulo: `${serie}-${num}`, marca: "COMPROBANTE SIMULADO",
    filas: [["Emisor", p.razon], ["RUC", p.ruc], ["Cliente", empresa.nombre], ["Orden", `${numero} · ${OBRA}`], ["Fecha", fmt(fecha)], ["Total", soles(total)], ...(retencion ? [["Retención 4ta (8 %)", soles(retencion)]] : [])],
  }));
  const id = Number(await rpc(logistica, "registrar_comprobante", {
    p_proveedor_id: p.id, p_tipo: tipo, p_serie: serie, p_numero: num, p_fecha: fechaISO(fecha), p_total: total,
    p_retencion: retencion, p_archivo_path: archivo, p_item_ids: lineas.map((l) => l.id), p_detraccion: null,
  }));
  await siLista(numero);
  return id;
}

/** OS: Logística envía el contrato al proveedor y (si `firmado`) sube el contrato firmado. */
async function contrato(numero, prov, { firmado = true } = {}) {
  await rpc(logistica, "enviar_contrato", { p_obra_id: obraId, p_numero: numero });
  if (!firmado) return;
  const p = PROVEEDORES[prov];
  const total = (await lineasDe(numero)).reduce((a, l) => a + Number(l.parcial), 0);
  const path = await subir(logistica, "documentos", `${obraId}/${numero}/CONTRATO/contrato-firmado.png`, await documentoPng({
    titulo: "CONTRATO DE LOCACIÓN DE SERVICIOS", subtitulo: `OS N° ${numero}`, marca: "CONTRATO SIMULADO", alto: 760,
    filas: [["Comitente", empresa.nombre], ["Locador", p.razon], ["RUC", p.ruc], ["Obra", OBRA], ["Retribución", `${soles(total)} (100 %)`], ["Fecha", fmt(hace(3))]],
  }));
  ok(await logistica.from("adjuntos").insert({ tipo: "CONTRATO", obra_id: obraId, numero_oc: numero, path, nombre: "contrato-firmado.png", mime: "image/png" }), "contrato firmado");
  await siLista(numero);
}

/**
 * Logística marca que la OC lleva guía. En el MVP la pide y Contabilidad la emite (si `emitir`); en prod 1
 * Logística la registra ya emitida, en un solo paso, con su N° y el archivo (si `emitir`).
 */
async function guia(numero, prov, { emitir }) {
  await rpc(logistica, "set_requiere_guia", { p_obra_id: obraId, p_numero: numero, p_requiere: true });
  if (PROD1 && !emitir) return;
  const lineas = await lineasDe(numero);
  const detalle = lineas.map((l) => {
    const p = partidas.find((x) => x.id === l.partida_id);
    return `${Number(l.cantidad)} ${p.items.unidad} ${p.items.descripcion}`;
  }).join("\n");
  const datos = {
    // Prod 1 arranca con «el proveedor con su unidad», lo más común.
    modalidad: PROD1 ? "PROVEEDOR" : "TERCERO", transportista_id: PROD1 ? null : transportista.id,
    placa: transportista.placa, licencia: transportista.licencia, detalle,
    punto_partida: `Almacén ${PROVEEDORES[prov].razon}, Trujillo`, punto_llegada: `Obra ${OBRA}, ${DIRECCION}`, fecha_traslado: fechaISO(new Date()),
  };
  const nGuia = `T${SERIE}-${String(9900 + correlativo++).padStart(6, "0")}`;
  const archivo = () => documentoPng({
    titulo: "GUÍA DE REMISIÓN ELECTRÓNICA", subtitulo: nGuia, marca: "GUÍA SIMULADA",
    filas: [["Orden de compra", numero], ["Transportista", PROD1 ? PROVEEDORES[prov].razon : transportista.razon_social], ["Placa", transportista.placa], ["Inicio del traslado", fmt(new Date())]],
  });
  if (PROD1) {
    const path = await subir(logistica, "documentos", `guias/${obraId}/${numero}/guia-${nGuia}.png`, await archivo());
    await rpc(logistica, "registrar_guia", { p_obra_id: obraId, p_numero: numero, p_datos: datos, p_numero_guia: nGuia, p_archivo_path: path });
    await siLista(numero);
    return;
  }
  const guiaId = Number(await rpc(logistica, "solicitar_guia", { p_obra_id: obraId, p_numero: numero, p_datos: datos }));
  if (!emitir) return;
  const path = await subir(contabilidad, "documentos", `guias/${obraId}/${numero}/guia-${nGuia}.png`, await archivo());
  await rpc(contabilidad, "emitir_guia", { p_id: guiaId, p_numero_guia: nGuia, p_archivo_path: path });
}

// Prod 1: la orden facturada con lo que le toca va sola a Tesorería (como en la app, tras cada acción de
// Logística); el envío explícito queda para el MVP.
async function siLista(numero) {
  if (PROD1) await rpc(logistica, "enviar_si_lista", { p_obra_id: obraId, p_numero: numero });
}
const aTesoreria = (numero) => (PROD1 ? siLista(numero) : rpc(logistica, "enviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero }));

/** Tesorería paga (todo el saldo o `monto`) con N° de operación y voucher. */
async function pagar(numero, prov, monto = null) {
  const { saldo } = ok(await tesoreria.from("v_por_pagar").select("saldo").eq("obra_id", obraId).eq("numero", numero).single(), `saldo ${numero}`);
  const importe = monto ?? Number(saldo);
  const p = PROVEEDORES[prov];
  const nOp = String(operacion++);
  const vPath = await subir(tesoreria, "documentos", `pagos/${empresa.id}/${obraId}-${numero}/voucher-${nOp}.png`, await documentoPng({
    titulo: p.banco, subtitulo: "Constancia de transferencia", marca: "VOUCHER SIMULADO", ancho: 600, alto: 700,
    filas: [["Monto", soles(importe)], ["Beneficiario", p.razon], ["Cuenta destino", p.cuenta], ["N° de operación", nOp], ["Fecha", fmt(new Date())]],
  }));
  await rpc(tesoreria, "pagar_documento", {
    p_obra_id: obraId, p_numero: numero, p_orden_pago_id: null, p_fecha: fechaISO(new Date()), p_banco: p.banco,
    p_numero_operacion: nOp, p_monto: importe, p_voucher_path: vPath, p_voucher_nombre: `voucher-${nOp}.png`,
  });
}

// Qué pide corregir Tesorería: DATOS (vuelve a Guía/Contrato con su factura), FACTURA (a Facturar) o PRECIOS
// (a Cotizando).
const rechazar = (numero, motivo, correccion) =>
  rpc(tesoreria, "rechazar_documento", {
    p_obra_id: obraId, p_numero: numero, p_orden_pago_id: null, p_motivo: motivo,
    p_factura_nueva: correccion !== "DATOS", p_correccion: correccion,
  });
/** Logística la reenvía corregida (rechazo por datos o documentos), con lo que corrigió. */
const reenviar = (numero, nota) => rpc(logistica, "reenviar_a_tesoreria", { p_obra_id: obraId, p_numero: numero, p_nota: nota });

const constancia = (numero) => rpc(logistica, "enviar_constancia", { p_obra_id: obraId, p_numero: numero });

/** Logística registra lo que llegó: `fraccion` de las primeras `n` líneas (1 = todo), con una foto demo. En prod 1 no. */
async function entregar(numero, fraccion, n = Infinity) {
  if (PROD1) return;
  for (const l of (await lineasDe(numero)).slice(0, n)) {
    const p = partidas.find((x) => x.id === l.partida_id);
    const cantidad = fraccion === 1 ? Number(l.cantidad) : redondear(Number(l.cantidad) * fraccion);
    const foto = await subir(logistica, "documentos", `entregas/${obraId}/${numero}/demo-${l.id}.png`, await fotoDemoPng({
      grupo: grupoFoto(p.items.tipo_material, p.items.rubro), descripcion: p.items.descripcion, fecha: new Date(),
    }));
    await rpc(logistica, "registrar_entrega", {
      p_oc_item_id: l.id, p_cantidad: cantidad, p_fotos: [foto], p_lat: null, p_lng: null, p_precision: null,
      p_capturado: new Date().toISOString(), p_observacion: null,
    });
  }
}

// ------------------------------------------------------------------ casos (en orden: el N° de orden sale de su posición)
const CASOS = [
  // Logística (antes de Tesorería)
  ["OC emitida, link sin enviar", async () => crear("OC", "ferreteria", { clavos: 20, alambre16: 40, disco: 5, cinta: 10, teflon: 30 })],
  ["OC con link enviado, el proveedor aún no cotiza", async () => {
    const n = await crear("OC", "sanitarios", { inodoro: 2, lavatorio: 2, soportes: 4, unas: 4, pernos: 8, cuello: 4, teflon: 20 });
    await enviarLink(n);
    return n;
  }],
  ["OC con cotización recibida del proveedor", async () => {
    const n = await crear("OC", "electro", { cable: 10, termo: 6, interruptor: 20, interruptor2: 10, cajaRect: 40, octogonal: 30, socate: 15 });
    await enviarLink(n);
    await cotizar(n);
    return n;
  }],
  ["OC con cotización con sobreprecio por aprobar", async () => {
    const n = await crear("OC", "ferreteria", { cemento: 100, antisalitre: 40, rapimix: 60, acero6: 100, alambre16: 30 });
    await enviarLink(n);
    await cotizar(n, () => 1.08); // sobre el máximo del cemento (P.U. + 1.5 %)
    return n;
  }],
  ["OC con precios confirmados, ítem con detracción, total sobre el mínimo", async () => {
    const n = await crear("OC", "agregados", { hormigon: 40, arena: 10, arenaFina: 8, prestamo: 15, gravilla: 5 });
    await confirmar(n, { precios: true });
    return n;
  }],
  ["OC con precios confirmados, ítem con detracción, total bajo el mínimo", async () => {
    const n = await crear("OC", "agregados", { hormigon: 12, arenaFina: 3, prestamo: 2 });
    await confirmar(n, { precios: true });
    return n;
  }],
  ["OS sin contrato firmado (no puede ir a Tesorería)", async () => {
    const n = await crear("OS", "electro", { conexion: 1 });
    await confirmar(n);
    await contrato(n, "electro", { firmado: false });
    await facturar(n, "electro");
    return n;
  }],
  [PROD1 ? "OC facturada sin guía: pasó sola a Tesorería" : "OC facturada por enviar a Tesorería", async () => {
    const n = await crear("OC", "ferreteria", { alambre: 50, disco: 10, clavos: 10, acero6: 80, alambre16: 20 });
    await confirmar(n, { precios: true });
    await facturar(n, "ferreteria");
    return n;
  }],
  [PROD1 ? "OC facturada que requiere guía, sin registrar: no puede ir a Tesorería" : "OC que requiere guía, guía solicitada sin emitir", async () => {
    const n = await crear("OC", "ferreteria", { acero58: 40, acero12: 30, acero6: 60, alambre: 20, cemento: 50 });
    await confirmar(n, { precios: true });
    await guia(n, "ferreteria", { emitir: false });
    if (PROD1) await facturar(n, "ferreteria");
    return n;
  }],
  // Tesorería (por pagar)
  ["OC con factura en Tesorería", async () => {
    const n = await crear("OC", "sanitarios", { lavaplatos: 4, ducha: 4, desague: 4, soportes: 4, teflon: 30, duchaPl: 6 });
    await enviarLink(n);
    await cotizar(n);
    await confirmar(n);
    await facturar(n, "sanitarios");
    await aTesoreria(n);
    return n;
  }],
  ["OC con factura con detracción (5 %) en Tesorería", async () => {
    const n = await crear("OC", "agregados", { hormigon: 30, gravilla: 20, arena: 10, prestamo: 10 });
    await confirmar(n, { precios: true });
    await facturar(n, "agregados");
    await aTesoreria(n);
    return n;
  }],
  ["OS de servicio con contrato y recibo por honorarios (retención 8 %)", async () => {
    const n = await crear("OS", "locador", { cuadrilla: 2 });
    await confirmar(n);
    await contrato(n, "locador");
    await facturar(n, "locador", "RXH");
    await aTesoreria(n);
    return n;
  }],
  ["OC con boleta en Tesorería", async () => {
    const n = await crear("OC", "bazar", { tubo: 10, pegamento: 4, teflon: 20, cinta: 5, cuello: 3 });
    await confirmar(n, { precios: true });
    await facturar(n, "bazar", "BOLETA");
    await aTesoreria(n);
    return n;
  }],
  // En prod 1 no ocurre: Logística registra la guía antes de enviar a Tesorería.
  ["OC que requiere guía no emitida (Falta guía)", { soloMvp: true }, async () => {
    const n = await crear("OC", "ferreteria", { cemento: 80, antisalitre: 30, rapimix: 40, alambre: 15 });
    await confirmar(n, { precios: true });
    await guia(n, "ferreteria", { emitir: false });
    await facturar(n, "ferreteria");
    // Esta base tiene la regla de prod 1 (no se envía a Tesorería sin la guía): para mostrar el caso como
    // en el MVP, la orden pasa a Tesorería directo, sin la función de la app.
    ok(await admin.from("ordenes_compra").update({ estado: "EN_TESORERIA" }).eq("obra_id", obraId).eq("numero", n), `a Tesorería ${n}`);
    return n;
  }],
  [PROD1 ? "OC que requiere guía ya registrada" : "OC que requiere guía ya emitida", async () => {
    const n = await crear("OC", "ferreteria", { cemento: 60, acero58: 20, acero12: 20, alambre: 15, clavos: 5 });
    await confirmar(n, { precios: true });
    await guia(n, "ferreteria", { emitir: true });
    await facturar(n, "ferreteria");
    await aTesoreria(n);
    return n;
  }],
  ["OC con 2 rechazos previos (por un documento y por la factura), de nuevo en Tesorería", async () => {
    const n = await crear("OC", "agregados", { bloque: 2000, rapimix: 50, arenaFina: 10, alambre: 10 });
    await enviarLink(n);
    await cotizar(n);
    await confirmar(n);
    await facturar(n, "agregados", "FACTURA", { diasAtras: 6 });
    await aTesoreria(n);
    await rechazar(n, "Falta la firma del residente en la conformidad", "DATOS");
    await reenviar(n, "Se adjuntó la conformidad firmada por el residente");
    await rechazar(n, "La factura indica 2 100 bloques: el proveedor emite nota de crédito y factura nueva", "FACTURA");
    await facturar(n, "agregados"); // vuelve a «Facturar» con sus precios: la factura nueva la manda sola
    await aTesoreria(n);
    return n;
  }],
  ["OS de subcontrato con contrato y factura (detracción 12 %)", async () => {
    const n = await crear("OS", "tierras", { desmonte: 120 });
    await confirmar(n);
    await contrato(n, "tierras");
    await facturar(n, "tierras");
    await aTesoreria(n);
    return n;
  }],
  // Después de Tesorería
  ["OC pagada, constancia por enviar", async () => {
    const n = await crear("OC", "electro", { toma: 30, termo: 10, termo20: 6, cajaPaso: 10, subtablero: 2, cinta: 10, interruptor: 20 });
    await confirmar(n, { precios: true });
    await facturar(n, "electro");
    await aTesoreria(n);
    await pagar(n, "electro");
    return n;
  }],
  [PROD1 ? "OC pagada con la constancia enviada (sin recepción)" : "OC en entrega: constancia enviada y una entrega parcial", async () => {
    const n = await crear("OC", "agregados", { arena: 40, gravilla: 30, arenaFina: 10, prestamo: 20, hormigon: 10 });
    await confirmar(n, { precios: true });
    await facturar(n, "agregados");
    await aTesoreria(n);
    await pagar(n, "agregados");
    await constancia(n);
    await entregar(n, 0.5, 3); // la mitad de las tres primeras líneas; el resto aún no llega
    return n;
  }],
  ["OC recibida: todo entregado", { soloMvp: true }, async () => {
    const n = await crear("OC", "sanitarios", { lavatorio: 4, inodoro: 2, lavaropa: 2, soportes: 4, unas: 4, desague: 4, duchaPl: 4, pernos: 8 });
    await enviarLink(n);
    await cotizar(n);
    await confirmar(n);
    await facturar(n, "sanitarios");
    await aTesoreria(n);
    await pagar(n, "sanitarios");
    await constancia(n);
    await entregar(n, 1);
    return n;
  }],
  ["OC rechazada por la factura: en «Facturar», esperando la factura nueva", async () => {
    const n = await crear("OC", "electro", { cable: 15, octogonal: 30, cajaRect: 40, socate: 15, interruptor2: 10 });
    await confirmar(n, { precios: true });
    await facturar(n, "electro");
    await aTesoreria(n);
    await rechazar(n, "El total de la factura no coincide con la orden: el proveedor emite nota de crédito y factura nueva", "FACTURA");
    return n;
  }],
  ["OC rechazada por datos: con su factura, por corregir y reenviar", async () => {
    const n = await crear("OC", "ferreteria", { clavos: 20, alambre: 30, disco: 5, acero6: 40, antisalitre: 20 });
    await confirmar(n, { precios: true });
    await facturar(n, "ferreteria");
    await aTesoreria(n);
    await rechazar(n, "Corregir la cuenta bancaria del proveedor antes del pago", "DATOS");
    return n;
  }],
  ["OC anulada", async () => {
    const n = await crear("OC", "sanitarios", { ducha: 2, duchaPl: 4, teflon: 10 });
    await rpc(logistica, "anular_orden", { p_obra_id: obraId, p_numero: n, p_motivo: "El residente pidió otro modelo de llave de ducha" });
    return n;
  }],
  // Mano de obra
  ["OS de mano de obra emitida, contrato por enviar", async () => crear("OS", "maestro", { moTarrajeo: 40 })],
  ["OS de mano de obra con contrato y recibo por honorarios (retención 8 %) en Tesorería", async () => {
    const n = await crear("OS", "maestro", { moBloque: 3000 });
    await confirmar(n);
    await contrato(n, "maestro");
    await facturar(n, "maestro", "RXH");
    await aTesoreria(n);
    return n;
  }],
  ["OS de mano de obra con contrato y factura en Tesorería", async () => {
    const n = await crear("OS", "contratista", { moInodoro: 5, moDucha: 5, moLavamanos: 5 });
    await confirmar(n);
    await contrato(n, "contratista");
    await facturar(n, "contratista");
    await aTesoreria(n);
    return n;
  }],
  ["OS de mano de obra pagada", async () => {
    const n = await crear("OS", "contratista", { moCableado: 4, moEnchape: 30 });
    await confirmar(n);
    await contrato(n, "contratista");
    await facturar(n, "contratista");
    await aTesoreria(n);
    await pagar(n, "contratista");
    return n;
  }],
  ["OS de mano de obra rechazada por los precios: en cotización", async () => {
    const n = await crear("OS", "maestro", { moBloque: 1500 });
    await confirmar(n);
    await contrato(n, "maestro");
    await facturar(n, "maestro", "RXH");
    await aTesoreria(n);
    await rechazar(n, "El metrado del asentado no coincide con lo trabajado: revisar la cantidad y el precio", "PRECIOS");
    return n;
  }],
];

const resumen = [];
// [caso, armar] o [caso, { soloMvp }, armar]
const casos = CASOS.map((c) => (c.length === 3 ? c : [c[0], {}, c[1]])).filter(([, o]) => !(PROD1 && o.soloMvp));
for (const [i, [caso, , armar]] of casos.entries()) {
  const numero = await armar();
  resumen.push({ n: i + 1, caso, numero });
}

// ---------- resumen con el estado final de cada orden
const ordenes = ok(await admin.from("ordenes_compra").select("numero, tipo, estado").eq("obra_id", obraId), "órdenes");
console.log(`\n${resumen.length} casos en la obra ${OBRA} (id ${obraId}):`);
for (const r of resumen) {
  const o = ordenes.find((x) => x.numero === r.numero);
  console.log(`  ${String(r.n).padStart(2)}  ${o.tipo} ${r.numero}  ${o.estado.padEnd(19)} ${r.caso}`);
}
