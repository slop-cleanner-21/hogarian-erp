import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@supabase/supabase-js";
import { coincide, crearServidorMcp } from "@/lib/asistente/mcp";
import { urlPagos, urlPresupuesto } from "@/lib/asistente/urls";
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
    } finally {
      await h.cerrar();
    }
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
    await expect(tes.getByRole("button", { name: "Asistente" })).toBeVisible();
    await tes.getByRole("button", { name: "Asistente" }).click();
    const hoja = tes.getByRole("dialog", { name: "Asistente" });
    await expect(hoja.getByRole("textbox", { name: "Mensaje" })).toBeFocused();
    await expect(hoja.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await expect(hoja.getByRole("button", { name: "Adjuntar foto" })).toBeEnabled();

    const log = await abrir("logistica", "/logistica");
    await expect(log.getByRole("button", { name: "Sugerencias" })).toBeVisible();
    await expect(log.getByRole("button", { name: "Asistente" })).toHaveCount(0);
  });
});
