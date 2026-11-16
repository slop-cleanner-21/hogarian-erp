import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@supabase/supabase-js";
import { coincide, crearServidorMcp } from "@/lib/asistente/mcp";
import { podar, pideEspacio, tituloDe } from "@/lib/asistente/chats";
import { Accion, destinoValido, enlaceOrden, enlaceValido, historialDe, MAX_TEXTO_TURNO, urlPagos, urlPresupuesto } from "@/lib/asistente/urls";
import { expect, test } from "./fixtures";
import { ROLES, sesionApi, sql, sql1 } from "./lib";

// Asistente de Tesorería (fase 1: lectura y filtros). Sin llamar a la API de Claude: las herramientas del servidor MCP
// (con la sesión de Tesorería), los enlaces de filtro, quién puede usar la ruta y dónde está el botón.

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const SB = "http://127.0.0.1:55321";

/** Las herramientas del asistente, conectadas en memoria y leyendo con la sesión del rol. */
async function herramientas(rol: keyof typeof ROLES, pantalla = "/tesoreria/consultas?obra=1") {
  const s = await sesionApi(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_SECRET_KEY, ROLES[rol]);
  const db = createClient(SB, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${s.access_token}` } }, auth: { persistSession: false } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente de la API y el del servidor son el mismo supabase-js
  const servidor = crearServidorMcp(db as any, { pantalla });
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

  test("enlaces de la respuesta: solo pantallas de Tesorería; acciones validadas; el historial recorta lo muy largo", () => {
    expect(enlaceValido(enlaceOrden(12, "100016"))).toBe(true);
    expect(enlaceValido("/tesoreria?empresa=1&area=log&doc=OC")).toBe(true);
    for (const malo of ["https://otro.sitio/tesoreria", "//otro.sitio/x", "/admin/usuarios", "/tesoreria/pago/x/1", "/tesoreria/pago/1/2/3", "javascript:alert(1)", "/tesoreria#x"])
      expect(enlaceValido(malo), malo).toBe(false);
    // La navegación automática sigue solo a Pagos o al Presupuesto; el pago de una orden va por abrir_orden (Accion).
    expect(destinoValido(enlaceOrden(1, "2"))).toBe(false);
    expect(Accion.safeParse({ tipo: "navegar", url: enlaceOrden(1, "2") }).success).toBe(true);
    expect(Accion.safeParse({ tipo: "navegar", url: "https://otro.sitio" }).success).toBe(false);
    expect(Accion.safeParse({ tipo: "abrir", que: "admin" }).success).toBe(false);
    expect(Accion.safeParse({ tipo: "tema", valor: "oscuro" }).success).toBe(true);
    const largo = historialDe([{ rol: "usuario", texto: "x".repeat(MAX_TEXTO_TURNO + 500) }]);
    expect(largo[0].texto.length).toBe(MAX_TEXTO_TURNO);
    // Chats: título de la primera pregunta, sin vacíos, del más reciente al más antiguo.
    expect(tituloDe([{ rol: "usuario", texto: "  cuánto\n le debo  " }])).toBe("cuánto le debo");
    const g = podar({
      actual: "b",
      chats: [
        { id: "a", titulo: "", creado: 1, actualizado: 1, turnos: [] },
        { id: "b", titulo: "", creado: 2, actualizado: 2, turnos: [] },
        { id: "c", titulo: "x", creado: 3, actualizado: 3, turnos: [{ rol: "usuario", texto: "x" }] },
      ],
    });
    expect(g.chats.map((c) => c.id)).toEqual(["c", "b"]);
    expect(pideEspacio("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(true);
    expect(pideEspacio("### Resumen\nhola")).toBe(true);
    expect(pideEspacio("Tienes S/ 1,200.00 por pagar.")).toBe(false);
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
      expect(nav.accion).toEqual({ tipo: "navegar", url: urlPagos({ empresa_id: Number(empresa), obra_id: Number(obra), etapas: etapas.slice(0, 1) }) });
      const otra = sql1(`select id from empresas where id <> ${empresa} order by id limit 1`);
      if (otra) expect((await h.llamar("aplicar_filtros_pagos", { obra_id: Number(obra), empresa_id: Number(otra) })).error).toBe(true);
      expect((await h.llamar("aplicar_filtros_pagos", { obra_id: 999999999 })).error).toBe(true);
      // Solo la empresa, o todas (el id va como número; «todas» es otro campo, para que el modelo no lo mande como texto).
      expect((await h.llamar("aplicar_filtros_pagos", { empresa_id: Number(empresa) })).json().accion.url).toBe(urlPagos({ empresa_id: Number(empresa) }));
      expect((await h.llamar("aplicar_filtros_pagos", { todas_las_empresas: true, doc: "OS" })).json().accion.url).toBe(urlPagos({ empresa_id: "todas", doc: "OS" }));
      expect((await h.llamar("aplicar_filtros_pagos", { empresa_id: Number(empresa), fecha: "la semana pasada" })).error).toBe(true);

      const pres = (await h.llamar("aplicar_filtros_presupuesto", { obra_id: Number(obra), rubro: "SUBCONTRATO" })).json();
      expect(pres.accion.url).toBe(urlPresupuesto({ obra_id: Number(obra), empresa_id: Number(empresa), rubro: "SUBCONTRATO" }));

      // El detalle de una orden: ítems, comprobantes y pagos, sin cuentas.
      const numero = sql1(`select numero from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC' and obra_id = ${obra} order by numero limit 1`);
      const det = (await h.llamar("detalle_orden", { obra_id: Number(obra), numero })).json();
      expect(det.orden.numero).toBe(numero);
      expect(det.orden.enlace).toBe(enlaceOrden(Number(obra), numero));
      expect(r.filas.every((f: { enlace: string }) => enlaceValido(f.enlace))).toBe(true);
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

  test("el panel (con la respuesta simulada): al filtrar se oculta con un aviso, sigue el chat al volver y achica las fotos", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    const destino = urlPresupuesto({ obra_id: Number(sql1("select min(obra_id) from partidas")), rubro: "MANO OBRA", etapas: ["ACB 1"] });
    const pedidos: { texto: string; historial: { rol: string }[]; imagenes: { data: string }[] }[] = [];
    await page.route("**/asistente", async (ruta) => {
      pedidos.push(ruta.request().postDataJSON());
      await ruta.fulfill({
        json: pedidos.length === 1 ? { texto: "Abrí el presupuesto.", acciones: [{ tipo: "navegar", url: destino }] } : { texto: "Listo.", acciones: [] },
      });
    });
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    const hoja = page.getByRole("region", { name: "Hogariano" });
    await hoja.getByRole("textbox", { name: "Mensaje" }).fill("mano de obra de la etapa ACB 1");
    await hoja.getByRole("button", { name: "Enviar" }).click();
    await page.waitForURL((u) => u.pathname === "/tesoreria/consultas" && u.searchParams.get("rubro") === "MANO OBRA" && u.searchParams.get("etapa") === "ACB 1");
    // Manejó la interfaz: el panel se oculta para que se vea, y un aviso breve dice qué hizo.
    await expect(hoja).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Abrí el presupuesto." })).toBeVisible();

    // Al volver a abrirlo sigue el mismo chat; la siguiente pregunta lleva el historial, empezando por la pregunta.
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    await expect(hoja.getByText("Abrí el presupuesto.")).toBeVisible();
    await expect(hoja.getByText("Filtró la pantalla")).toBeVisible();
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

  test("el panel: corto queda chico; tabla o largo se agranda solo; enlaces solo a Tesorería; chats y ajustes", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    const orden = sql(`select obra_id, numero from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC' order by obra_id, numero limit 1`)[0];
    const enlace = enlaceOrden(Number(orden[0]), orden[1]);
    const respuestas = [
      { texto: "Tienes **S/ 1,200.00** por pagar.", acciones: [] },
      {
        texto: `### Por pagar\n\n| Orden | Saldo |\n|---|---:|\n| [OC ${orden[1]}](${enlace}) | S/ 10.00 |\n\n[otro sitio](https://otro.sitio/robar)`,
        acciones: [],
      },
      { texto: Array.from({ length: 14 }, (_, i) => `Línea ${i + 1} de una respuesta larga sin tablas.`).join("\n\n"), acciones: [] },
    ];
    let n = 0;
    await page.route("**/asistente", (ruta) => ruta.fulfill({ json: respuestas[Math.min(n++, respuestas.length - 1)] }));
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    const hoja = page.getByRole("region", { name: "Hogariano" });
    const preguntar = async (t: string) => {
      await hoja.getByRole("textbox", { name: "Mensaje" }).fill(t);
      await hoja.getByRole("button", { name: "Enviar" }).click();
    };

    // Corta: cabe en el panel chico, con su formato (negrita).
    await preguntar("cuánto debo");
    await expect(hoja.locator("strong", { hasText: "S/ 1,200.00" })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(hoja.getByRole("button", { name: "Agrandar" })).toBeVisible();

    // Con tabla y subtítulo: se agranda solo; el enlace a la orden abre su pago (y el panel se oculta); el de afuera es texto.
    await preguntar("las de este mes");
    await expect(hoja.getByRole("button", { name: "Achicar" })).toBeVisible();
    await expect(hoja.getByRole("table")).toBeVisible();
    await expect(hoja.getByRole("link", { name: "otro sitio" })).toHaveCount(0);
    await expect(hoja.getByText("otro sitio")).toBeVisible();

    // Larga sin tablas: se mide y, como no cabe, se agranda sola.
    await hoja.getByRole("button", { name: "Achicar" }).click();
    await preguntar("explícame");
    await expect(hoja.getByText("Línea 14 de una respuesta larga sin tablas.")).toBeAttached();
    await expect(hoja.getByRole("button", { name: "Achicar" })).toBeVisible();

    await hoja.getByRole("link", { name: `OC ${orden[1]}` }).click();
    await page.waitForURL((u) => u.pathname === enlace);
    await expect(hoja).toHaveCount(0);

    // Chats: uno nuevo, la lista con los dos, volver al primero y borrar.
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    await hoja.getByRole("button", { name: "Nuevo chat" }).click();
    await expect(hoja.getByText("Línea 14 de una respuesta larga sin tablas.")).toHaveCount(0);
    await preguntar("otra cosa");
    await hoja.getByRole("button", { name: "Chats", exact: true }).click();
    const lista = hoja.getByRole("list", { name: "Chats" });
    await expect(lista.getByRole("listitem")).toHaveCount(2);
    await lista.getByRole("button", { name: /^cuánto debo/ }).click();
    await expect(hoja.getByText("Tienes")).toBeVisible();

    // Ajuste «Chat nuevo»: al cerrarlo y abrirlo con el botón empieza vacío; el anterior sigue en la lista.
    await hoja.getByRole("button", { name: "Ajustes de Hogariano" }).click();
    await hoja.getByRole("radio", { name: "Chat nuevo" }).click();
    await expect(hoja.getByRole("radio", { name: "Chat nuevo" })).toHaveAttribute("aria-checked", "true");
    await hoja.getByRole("button", { name: "Cerrar Hogariano" }).click();
    await page.getByRole("button", { name: "Hogariano", exact: true }).click();
    await expect(hoja.getByText("Tienes")).toHaveCount(0);
    await hoja.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(lista.getByRole("listitem")).toHaveCount(2);
    await lista.getByRole("button", { name: /^Borrar «otra cosa»/ }).click();
    await expect(lista.getByRole("listitem")).toHaveCount(1);

    // Los chats quedan al recargar (en el dispositivo).
    // (El panel vuelve como estaba: abierto.)
    await page.reload();
    await expect(hoja).toBeVisible();
    await hoja.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(lista.getByRole("listitem")).toHaveCount(1);
  });

  test("el panel maneja la interfaz: tema oscuro y el menú del usuario, ocultándose", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    const respuestas = [
      { texto: "Listo: modo oscuro.", acciones: [{ tipo: "tema", valor: "oscuro" }] },
      { texto: "Abrí tu menú.", acciones: [{ tipo: "abrir", que: "menu" }] },
      { texto: "Tus ajustes.", acciones: [{ tipo: "abrir", que: "ajustes_hogariano" }] },
    ];
    let n = 0;
    await page.route("**/asistente", (ruta) => ruta.fulfill({ json: respuestas[n++] }));
    const hoja = page.getByRole("region", { name: "Hogariano" });
    const preguntar = async (t: string) => {
      await page.getByRole("button", { name: "Hogariano", exact: true }).click();
      await hoja.getByRole("textbox", { name: "Mensaje" }).fill(t);
      await hoja.getByRole("button", { name: "Enviar" }).click();
    };
    try {
      await preguntar("ponlo oscuro");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(hoja).toHaveCount(0);

      await preguntar("abre mi menú");
      await expect(hoja).toHaveCount(0);
      await expect(page.getByRole("radiogroup", { name: "Tema" })).toBeVisible();
      await page.keyboard.press("Escape");

      // Sus propios ajustes no lo ocultan: los muestra en el panel.
      await preguntar("tus ajustes");
      await expect(hoja.getByRole("radio", { name: "Último chat" })).toBeVisible();
    } finally {
      await page.evaluate(() => localStorage.removeItem("erp-theme")).catch(() => {});
    }
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

  test("las más grandes por pagar: con orden monto.desc salen de todas las filas, no de las primeras por fecha", async () => {
    const esperadas = sql(`select numero, saldo from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC' order by saldo desc, obra_id, numero limit 3`);
    test.skip(esperadas.length < 3, "pocas OC por pagar");
    const h = await herramientas("tesoreria");
    try {
      const r = (await h.llamar("consultar_documentos", { doc: "OC", estado: "pendiente", orden: "monto.desc", limite: 3 })).json();
      expect(r.orden).toBe("monto.desc");
      expect(r.sin_mostrar).toBe(r.cantidad - 3);
      expect(r.filas.map((f: { saldo: number }) => Number(f.saldo))).toEqual(esperadas.map(([, s]) => Number(s)));
      // Las sumas siguen siendo de todas, no de las que vinieron.
      expect(r.saldo).toBeCloseTo(Number(sql1(`select sum(saldo) from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC'`)), 2);
      // Sin orden, como la pantalla: las más antiguas primero.
      const porFecha = (await h.llamar("consultar_documentos", { doc: "OC", estado: "pendiente", limite: 50 })).json();
      expect(porFecha.orden).toBe("fecha.asc");
      const fechas = porFecha.filas.map((f: { fecha: string }) => f.fecha);
      expect(fechas).toEqual([...fechas].sort());
    } finally {
      await h.cerrar();
    }
  });

  test("resumen por grupo: por proveedor y por etapa, sumado en el servidor, cuadra con la base", async () => {
    const pend = `from v_por_pagar where estado = 'PENDIENTE' and doc in ('OC', 'OS')`;
    const saldo = Number(sql1(`select coalesce(sum(saldo), 0) ${pend}`));
    test.skip(saldo === 0, "nada por pagar");
    const [provTop, saldoTop] = sql(`select proveedor, sum(saldo) s ${pend} group by proveedor order by s desc, proveedor limit 1`)[0];
    const h = await herramientas("tesoreria");
    try {
      const p = (await h.llamar("resumen_por_grupo", { por: "proveedor", limite: 3 })).json();
      expect(p.saldo).toBeCloseTo(saldo, 2);
      expect(p.ordenes).toBe(Number(sql1(`select count(*) ${pend}`)));
      expect(p.grupos[0].grupo.startsWith(provTop)).toBe(true);
      expect(p.grupos[0].saldo).toBeCloseTo(Number(saldoTop), 2);
      // Lo mostrado más el resto es todo.
      const mostrado = p.grupos.reduce((s: number, g: { saldo: number }) => s + g.saldo, 0);
      expect(mostrado + (p.resto?.saldo ?? 0)).toBeCloseTo(saldo, 1);

      // Por etapa: una orden reparte su saldo entre sus etapas, así que las etapas suman lo mismo.
      const e = (await h.llamar("resumen_por_grupo", { por: "etapa", limite: 50 })).json();
      const porEtapa = e.grupos.reduce((s: number, g: { saldo: number }) => s + g.saldo, 0) + (e.resto?.saldo ?? 0);
      expect(porEtapa).toBeCloseTo(saldo, 0);
    } finally {
      await h.cerrar();
    }
  });

  test("compras de un ítem: cantidad, monto y último P.U. como en la base (sin anuladas ni cotizando)", async () => {
    const fila = sql(
      `select i.id, i.descripcion, count(*) n from v_oc_items_calc l join items i on i.id = l.item_id
       where l.estado not in ('ANULADA', 'EMITIDA') and not coalesce(l.es_retencion, false) and i.descripcion ~ '^[A-Z ]+$'
       group by i.id, i.descripcion order by n desc limit 1`,
    )[0];
    test.skip(!fila, "sin compras");
    const [id, descripcion] = fila;
    const base = `from v_oc_items_calc where item_id = ${id} and estado not in ('ANULADA', 'EMITIDA') and not coalesce(es_retencion, false)`;
    const [cantidad, monto] = sql(`select sum(cantidad), sum(parcial) ${base}`)[0];
    const h = await herramientas("tesoreria");
    try {
      const r = (await h.llamar("compras_de_item", { texto: descripcion, limite: 5 })).json();
      const it = r.por_item.find((x: { item: string }) => x.item === descripcion);
      expect(it, `${descripcion} en ${JSON.stringify(r.por_item.map((x: { item: string }) => x.item))}`).toBeTruthy();
      expect(it.cantidad).toBeCloseTo(Number(cantidad), 2);
      expect(it.monto).toBeCloseTo(Number(monto), 2);
      expect(it.pu_min).toBeLessThanOrEqual(it.pu_max);
      expect(r.ultimas_lineas.length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(r)).not.toMatch(/cuenta_bancaria|token/);
      // Un texto que no es ningún ítem se dice, no se responde con ceros.
      expect((await h.llamar("compras_de_item", { texto: "zzqx inexistente" })).error).toBe(true);
    } finally {
      await h.cerrar();
    }
  });

  test("resumen del presupuesto de una obra: presupuestado y pagado cuadran con la base", async () => {
    const obra = sql1(`select obra_id from v_avance_partida group by obra_id order by count(*) desc limit 1`);
    test.skip(!obra, "sin presupuestos");
    const presupuestado = Number(sql1(`select sum(parcial) from v_avance_partida where obra_id = ${obra}`));
    const pagado = Number(
      sql1(
        `select coalesce(sum(l.parcial), 0) from v_oc_items_calc l join v_avance_partida p on p.partida_id = l.partida_id
         where l.obra_id = ${obra} and l.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')`,
      ),
    );
    const h = await herramientas("tesoreria");
    try {
      const r = (await h.llamar("resumen_presupuesto", { obra_id: Number(obra), por: "rubro" })).json();
      expect(r.presupuestado).toBeCloseTo(presupuestado, 1);
      expect(r.pagado).toBeCloseTo(pagado, 1);
      const x = (await h.llamar("resumen_presupuesto", { obra_id: Number(obra), por: "partida", orden: "excedido", limite: 3 })).json();
      expect(x.grupos.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < x.grupos.length; i++) expect(x.grupos[i - 1].excedido).toBeGreaterThanOrEqual(x.grupos[i].excedido);
      expect(x.grupos[0]).toHaveProperty("cantidades");
    } finally {
      await h.cerrar();
    }
  });

  test("herramientas de la interfaz: abrir una orden, el tema y las hojas devuelven una acción válida; no inventan", async () => {
    const orden = sql(`select obra_id, numero from v_por_pagar where doc = 'OC' order by obra_id, numero limit 1`)[0];
    const h = await herramientas("tesoreria");
    try {
      const o = (await h.llamar("abrir_orden", { obra_id: Number(orden[0]), numero: orden[1] })).json();
      expect(o.accion).toEqual({ tipo: "navegar", url: enlaceOrden(Number(orden[0]), orden[1]) });
      expect((await h.llamar("abrir_orden", { obra_id: Number(orden[0]), numero: "999999999" })).error).toBe(true);
      expect((await h.llamar("cambiar_tema", { tema: "oscuro" })).json().accion).toEqual({ tipo: "tema", valor: "oscuro" });
      expect((await h.llamar("abrir_en_la_app", { que: "menu" })).json().accion).toEqual({ tipo: "abrir", que: "menu" });
      expect((await h.llamar("abrir_en_la_app", { que: "admin" })).error).toBe(true);
      expect((await h.llamar("ir_a_pantalla", { pantalla: "presupuesto" })).json().accion).toEqual({ tipo: "navegar", url: "/tesoreria/consultas" });
      // Los grupos por proveedor traen su enlace a Pagos filtrado (uno por tipo de orden).
      const g = (await h.llamar("resumen_por_grupo", { por: "proveedor", limite: 5 })).json();
      for (const x of g.grupos) {
        const enlaces = [x.enlace, x.enlace_oc, x.enlace_os].filter(Boolean);
        expect(enlaces.length, x.grupo).toBeGreaterThan(0);
        for (const e of enlaces) {
          expect(enlaceValido(e)).toBe(true);
          expect(new URL(e, "https://x").searchParams.get("proveedor")).toBeTruthy();
        }
      }
    } finally {
      await h.cerrar();
    }
  });

  test("crear una sugerencia por chat: le llega al Admin marcada «con Hogariano», una por pregunta", async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const marca = `E2E-HOG-${Date.now()}`;
    const limpiar = () => {
      sql(`delete from notificaciones where tipo = 'SUGERENCIA' and cuerpo like '%${marca}%'`);
      sql(`delete from audit_log where tabla = 'sugerencias' and detalle::text like '%${marca}%'`);
      sql(`delete from sugerencias where texto like '%${marca}%'`);
    };
    const h = await herramientas("tesoreria");
    try {
      const r = (await h.llamar("crear_sugerencia", { tipo: "MEJORA", texto: `Poder ordenar Pagos por proveedor ${marca}` })).json();
      expect(r.enviada).toBe(true);
      const [origen, pantalla, ruta, rol] = sql(`select origen, pantalla, ruta, rol from sugerencias where texto like '%${marca}%'`)[0];
      expect(origen).toBe("HOGARIANO");
      expect(pantalla).toBe("Tesorería › Presupuesto");
      expect(ruta).toBe("/tesoreria/consultas?obra=1");
      expect(rol).toBe("TESORERIA");
      expect(sql1(`select titulo from notificaciones where tipo = 'SUGERENCIA' and cuerpo like '%${marca}%' limit 1`)).toMatch(/con Hogariano/);
      // Una por pregunta.
      expect((await h.llamar("crear_sugerencia", { tipo: "ERROR", texto: `otra más ${marca}` })).error).toBe(true);
      expect(sql1(`select count(*) from sugerencias where texto like '%${marca}%'`)).toBe("1");
    } finally {
      await h.cerrar();
      limpiar();
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
