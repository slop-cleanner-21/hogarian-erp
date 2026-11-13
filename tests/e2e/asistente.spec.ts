import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@supabase/supabase-js";
import { coincide, crearServidorMcp } from "@/lib/asistente/mcp";
import { destinoValido, historialDe, urlPagos, urlPresupuesto } from "@/lib/asistente/urls";
import { expect, test } from "./fixtures";
import { ROLES, sesionApi, sql, sql1 } from "./lib";

// Asistente de Tesorería (fase 1: lectura y filtros). Sin llamar a la API de Claude: las herramientas del servidor MCP
// (con la sesión de Tesorería), los enlaces de filtro, quién puede usar la ruta y dónde está el botón.

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const SB = "http://127.0.0.1:55321";

/** Las herramientas del asistente, conectadas en memoria y leyendo con la sesión del rol. */
async function herramientas(rol: keyof typeof ROLES) {
  const s = await sesionApi(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_SECRET_KEY, ROLES[rol]);
  const db = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${s.access_token}` } }, auth: { persistSession: false } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente de la API y el del servidor son el mismo supabase-js
  const servidor = crearServidorMcp(db as any);
  const cliente = new Client({ name: "prueba", version: "0" });
  await Promise.all([servidor.connect(b), cliente.connect(a)]);
  const llamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await cliente.callTool({ name, arguments: args });
    const texto = (r.content as { text: string }[]).map((c) => c.text).join("");
    return { error: r.isError === true, texto, json: () => JSON.parse(texto) };
  };
  return { llamar, cerrar: () => Promise.allSettled([cliente.close(), servidor.close()]) };
}

test.describe("@tesoreria @asistente", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("enlaces: los arma el servidor con los parámetros de cada pantalla, y no acepta valores fuera de lo permitido", () => {
    expect(urlPagos({ empresa_id: 2, obra_id: 10, doc: "OS", estado: "pagado", etapas: ["L1A", "L1A", "L2B"] })).toBe(
      "/tesoreria?empresa=2&area=log&doc=OS&est=pag&obra=10&etapa=L1A%2CL2B",
    );
    // Por defecto OC por pagar; la pestaña Rechazos no lleva etapas ni monto (la pantalla no los filtra ahí).
    expect(urlPagos({ empresa_id: "todas" })).toBe("/tesoreria?empresa=todas&area=log&doc=OC&est=pend");
    expect(urlPagos({ empresa_id: 1, estado: "rechazos", etapas: ["L1A"], monto: "alto", fecha: "mes" })).toBe(
      "/tesoreria?empresa=1&area=log&doc=OC&est=rec&fecha=mes",
    );
    expect(urlPagos({ empresa_id: 1, fecha: "2026-10-01_2026-10-31" })).toContain("fecha=2026-10-01_2026-10-31");
    expect(() => urlPagos({ empresa_id: 1, fecha: "ayer" })).toThrow();
    expect(() => urlPagos({ empresa_id: 1, etapas: ["L1A&x=1".repeat(5)] })).toThrow();
    expect(urlPresupuesto({ obra_id: 3, empresa_id: 1, rubro: "MANO OBRA", pago: "porpagar", etapas: ["L0"] })).toBe(
      "/tesoreria/consultas?empresa=1&obra=3&rubro=MANO+OBRA&etapa=L0&pago=porpagar",
    );
  });

  test("la hoja solo navega a Pagos o al Presupuesto, y el historial empieza con una pregunta y no pasa de 20 turnos", () => {
    expect(destinoValido(urlPresupuesto({ obra_id: 3, rubro: "MANO OBRA", etapas: ["ACB 1"] }))).toBe(true);
    expect(destinoValido("/tesoreria?empresa=1&area=log&doc=OC&est=pend")).toBe(true);
    for (const malo of ["https://otro.sitio/tesoreria", "//otro.sitio/tesoreria", "/logistica?obra=1", "/tesoreria/pago/1/2", "javascript:alert(1)"])
      expect(destinoValido(malo), malo).toBe(false);
    const turnos = Array.from({ length: 25 }, (_, i) => ({ rol: i % 2 ? ("asistente" as const) : ("usuario" as const), texto: String(i) }));
    const h = historialDe(turnos);
    expect(h.length).toBeLessThanOrEqual(20);
    expect(h[0].rol).toBe("usuario");
    expect(historialDe([{ rol: "asistente", texto: "hola" }])).toEqual([]);
  });

  test("buscar por nombre: sin tildes ni mayúsculas, palabras en cualquier orden y abreviadas", () => {
    expect(coincide("CONSTRUCCIÓN SAN MARTÍN", "san martin")).toBe(true);
    expect(coincide("CONSTRUCCIÓN SAN MARTÍN", "martín const")).toBe(true);
    expect(coincide("CONSTRUCCIÓN SAN MARTÍN", "san pedro")).toBe(false);
    expect(coincide("CONSTRUCCIÓN SAN MARTÍN", "")).toBe(false);
  });

  test("herramientas con la sesión de Tesorería: buscar la obra, sus etapas, consultar lo mismo que la pantalla y armar el filtro", async () => {
    // Una obra con OC por pagar (de los datos que haya).
    const fila = sql(
      `select v.obra_id, o.nombre, o.empresa_id, count(*) from v_por_pagar v join obras o on o.id = v.obra_id
        where v.estado = 'PENDIENTE' and v.doc = 'OC' group by 1, 2, 3 order by 4 desc, 1 limit 1`,
    )[0];
    test.skip(!fila, "no hay OC por pagar");
    const [obra, nombre, empresa, cuantas] = fila;
    const h = await herramientas("tesoreria");
    try {
      // Por su nombre en minúsculas y sin tildes.
      const obras = (await h.llamar("buscar_obras", { texto: nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") })).json();
      expect(obras.map((o: { id: number }) => String(o.id))).toContain(obra);

      const etapas = (await h.llamar("etapas_de_obra", { obra_id: Number(obra) })).json() as string[];
      expect(etapas.length).toBeGreaterThan(0);

      const r = (await h.llamar("consultar_documentos", { obra_id: Number(obra), doc: "OC", estado: "pendiente" })).json();
      expect(String(r.cantidad)).toBe(cuantas);
      const saldo = sql1(`select coalesce(sum(saldo), 0) from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC' and obra_id = ${obra}`);
      expect(r.saldo).toBeCloseTo(Number(saldo), 2);
      // Sin cuentas bancarias ni enlaces del proveedor.
      expect(JSON.stringify(r)).not.toMatch(/cuenta_bancaria|token/);

      // La empresa sale de la obra; con otra empresa, no.
      const nav = (await h.llamar("aplicar_filtros_pagos", { obra_id: Number(obra), etapas: etapas.slice(0, 1) })).json();
      expect(nav.navegar).toBe(urlPagos({ empresa_id: Number(empresa), obra_id: Number(obra), etapas: etapas.slice(0, 1) }));
      const otra = sql1(`select id from empresas where id <> ${empresa} order by id limit 1`);
      if (otra) expect((await h.llamar("aplicar_filtros_pagos", { obra_id: Number(obra), empresa_id: Number(otra) })).error).toBe(true);
      expect((await h.llamar("aplicar_filtros_pagos", { obra_id: 999999999 })).error).toBe(true);
      // Solo la empresa, o todas (el id va como número; «todas» es otro campo, para que el modelo no lo mande como texto).
      expect((await h.llamar("aplicar_filtros_pagos", { empresa_id: Number(empresa) })).json().navegar).toBe(urlPagos({ empresa_id: Number(empresa) }));
      expect((await h.llamar("aplicar_filtros_pagos", { todas_las_empresas: true, doc: "OS" })).json().navegar).toBe(urlPagos({ empresa_id: "todas", doc: "OS" }));
      expect((await h.llamar("aplicar_filtros_pagos", { empresa_id: Number(empresa), fecha: "la semana pasada" })).error).toBe(true);

      const pres = (await h.llamar("aplicar_filtros_presupuesto", { obra_id: Number(obra), rubro: "SUBCONTRATO" })).json();
      expect(pres.navegar).toBe(urlPresupuesto({ obra_id: Number(obra), empresa_id: Number(empresa), rubro: "SUBCONTRATO" }));

      // El detalle de una orden: ítems, comprobantes y pagos, sin cuentas.
      const numero = sql1(`select numero from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC' and obra_id = ${obra} order by numero limit 1`);
      const det = (await h.llamar("detalle_orden", { obra_id: Number(obra), numero })).json();
      expect(det.orden.numero).toBe(numero);
      expect(det.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(det)).not.toMatch(/cuenta_bancaria|token/);
      // Un N° con caracteres de filtro no pasa.
      expect((await h.llamar("detalle_orden", { obra_id: Number(obra), numero: "1),obra_id.gt.(0" })).error).toBe(true);
      // Una fecha que no es de la lista no se ignora: se rechaza.
      expect((await h.llamar("consultar_documentos", { obra_id: Number(obra), fecha: "ayer" })).error).toBe(true);
    } finally {
      await h.cerrar();
    }
  });

  test("detalle de una orden pagada: sus pagos suman lo que dice la base", async () => {
    const fila = sql(
      `select obra_id, numero, pagado from v_por_pagar where estado = 'PAGADO' and doc = 'OC' and pagado > 0 order by obra_id desc, numero desc limit 1`,
    )[0];
    test.skip(!fila, "no hay OC pagadas");
    const [obra, numero, pagado] = fila;
    const h = await herramientas("tesoreria");
    try {
      const det = (await h.llamar("detalle_orden", { obra_id: Number(obra), numero })).json();
      expect(det.pagos.length).toBeGreaterThan(0);
      const suma = det.pagos.reduce((a: number, p: { monto: number }) => a + Number(p.monto), 0);
      // Un pago puede cubrir varias órdenes (por su comprobante): lo aplicado es al menos lo pagado de esta.
      expect(suma).toBeGreaterThanOrEqual(Number(pagado) - 0.01);
      expect(det.pagos[0]).toHaveProperty("fecha");
      expect(det.comprobantes.length).toBeGreaterThan(0);
    } finally {
      await h.cerrar();
    }
  });

  test("rechazos de un proveedor: se filtran por su RUC, como la pantalla", async () => {
    const fila = sql(`select p.id, r.ruc from v_rechazos r join proveedores p on p.ruc_o_cod = r.ruc where r.doc = 'OC' limit 1`)[0];
    test.skip(!fila, "no hay rechazos");
    const [prov, ruc] = fila;
    const h = await herramientas("tesoreria");
    try {
      const r = (await h.llamar("consultar_documentos", { estado: "rechazos", doc: "OC", proveedor_id: Number(prov) })).json();
      expect(String(r.cantidad)).toBe(sql1(`select count(*) from v_rechazos where doc = 'OC' and ruc = '${ruc}'`));
      expect(r.filas.every((f: { ruc: string }) => f.ruc === ruc)).toBe(true);
    } finally {
      await h.cerrar();
    }
  });

  test("la hoja (con la respuesta simulada): navega con espacios en el filtro, guarda la conversación y achica las fotos", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    const destino = urlPresupuesto({ obra_id: Number(sql1("select min(obra_id) from partidas")), rubro: "MANO OBRA", etapas: ["ACB 1"] });
    const pedidos: { texto: string; historial: { rol: string }[]; imagenes: { data: string }[] }[] = [];
    await page.route("**/asistente", async (ruta) => {
      pedidos.push(ruta.request().postDataJSON());
      await ruta.fulfill({ json: pedidos.length === 1 ? { texto: "Abrí el presupuesto.", navegar: destino } : { texto: "Listo.", navegar: null } });
    });
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    const hoja = page.getByRole("region", { name: "Hogariano" });
    await hoja.getByRole("textbox", { name: "Mensaje" }).fill("mano de obra de la etapa ACB 1");
    await hoja.getByRole("button", { name: "Enviar" }).click();
    await page.waitForURL((u) => u.pathname === "/tesoreria/consultas" && u.searchParams.get("rubro") === "MANO OBRA" && u.searchParams.get("etapa") === "ACB 1");

    // El panel sigue abierto al navegar, con la respuesta; la siguiente pregunta lleva el historial, empezando por la pregunta.
    await expect(hoja.getByText("Abrí el presupuesto.")).toBeVisible();
    // Una foto de teléfono grande (4000 x 3000, con ruido: lo peor para el JPEG) se achica antes de mandarla.
    const png = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 4000;
      c.height = 3000;
      const ctx = c.getContext("2d")!;
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) % 256;
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    await hoja.locator('input[type="file"]').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(hoja.getByRole("img", { name: "Foto 1" })).toBeVisible();
    await hoja.getByRole("textbox", { name: "Mensaje" }).fill("y esta factura?");
    await hoja.getByRole("button", { name: "Enviar" }).click();
    await expect(hoja.getByText("Listo.")).toBeVisible();
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1].historial.map((t) => t.rol)).toEqual(["usuario", "asistente"]);
    expect(pedidos[1].imagenes).toHaveLength(1);
    expect(pedidos[1].imagenes[0].data.length).toBeLessThanOrEqual(1_200_000);
    const lado = await page.evaluate(async (d) => {
      const b = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${d}`)).blob());
      return Math.max(b.width, b.height);
    }, pedidos[1].imagenes[0].data);
    expect(lado).toBeLessThanOrEqual(1568);
  });

  test("dictado (simulado): se nota que está escuchando, el texto llega al campo y se detiene", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    await page.evaluate(() => {
      class R {
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => this.onresult?.({ results: [{ 0: { transcript: "las OS pagadas" } }] }), 100);
        }
        stop() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, "SpeechRecognition", { value: R, configurable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", { value: R, configurable: true });
    });
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    const panel = page.getByRole("region", { name: "Hogariano" });
    await panel.getByRole("button", { name: "Hablar" }).click();
    await expect(panel.getByRole("button", { name: "Dejar de escuchar" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("status").filter({ hasText: "Escuchando" })).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Mensaje" })).toHaveValue("las OS pagadas");
    await panel.getByRole("button", { name: "Dejar de escuchar" }).click();
    await expect(panel.getByRole("button", { name: "Hablar" })).toBeVisible();
    await expect(panel.getByRole("status").filter({ hasText: "Escuchando" })).toHaveCount(0);
    await expect(panel.getByRole("textbox", { name: "Mensaje" })).toHaveValue("las OS pagadas");
  });

  test("las herramientas leen con la sesión de quien pregunta: el Jefe de Operaciones no ve montos", async () => {
    const h = await herramientas("jefe");
    try {
      const r = await h.llamar("consultar_documentos", { estado: "pendiente" });
      // La base no le da v_por_pagar: error o nada, nunca montos.
      expect(r.error || r.json().cantidad === 0).toBe(true);
    } finally {
      await h.cerrar();
    }
  });

  test("la ruta: solo Tesorería (y el Admin); un pedido mal armado se rechaza sin llamar a la API", async ({ abrir }) => {
    const tes = await abrir("tesoreria", "/tesoreria");
    const malo = await tes.request.post("/asistente", { data: { texto: "x".repeat(3000) } });
    expect(malo.status()).toBe(400);
    const vacio = await tes.request.post("/asistente", { data: { texto: "" } });
    expect(vacio.status()).toBe(400);

    const log = await abrir("logistica", "/logistica");
    const r = await log.request.post("/asistente", { data: { texto: "hola" }, maxRedirects: 0 });
    expect(r.status(), "Logística no usa el asistente").not.toBe(200);
  });

  test("el botón está en Tesorería (Pagos y Presupuesto), no en otras áreas", async ({ abrir }) => {
    const tes = await abrir("tesoreria", "/tesoreria/consultas");
    await expect(tes.getByRole("button", { name: "Hogariano", exact: true })).toBeVisible();
    await tes.getByRole("button", { name: "Hogariano", exact: true }).click();
    const hoja = tes.getByRole("region", { name: "Hogariano" });
    await expect(hoja.getByRole("textbox", { name: "Mensaje" })).toBeFocused();
    await expect(hoja.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await expect(hoja.getByRole("button", { name: "Adjuntar foto" })).toBeEnabled();
    // No tapa la app: con el panel abierto se sigue usando la pantalla de arriba, y el panel sigue ahí.
    await tes.getByRole("button", { name: "Hogariano", exact: true }).click();
    await expect(hoja).toHaveCount(0);
    await tes.goto("/tesoreria");
    await tes.getByRole("button", { name: "Hogariano", exact: true }).click();
    await expect(hoja).toBeVisible();
    const pestaña = tes.getByRole("tab", { name: /^OS/ }).or(tes.getByRole("link", { name: /^OS/ })).first();
    if (await pestaña.count()) {
      await pestaña.click();
      await tes.waitForURL(/doc=OS/);
      await expect(hoja).toBeVisible();
    }
    await hoja.getByRole("button", { name: "Agrandar" }).click();
    await expect(hoja.getByRole("button", { name: "Achicar" })).toBeVisible();
    await hoja.getByRole("button", { name: "Cerrar Hogariano" }).click();
    await expect(hoja).toHaveCount(0);

    const log = await abrir("logistica", "/logistica");
    await expect(log.getByRole("button", { name: "Sugerencias" })).toBeVisible();
    await expect(log.getByRole("button", { name: "Hogariano", exact: true })).toHaveCount(0);
  });
});
