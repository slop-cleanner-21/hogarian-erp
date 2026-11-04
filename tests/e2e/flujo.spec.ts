import crypto from "node:crypto";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sql, sql1 } from "./lib";

// El flujo completo de una OC, solo por las pantallas (sin seeds ni SQL para avanzar; SQL solo para comprobar y
// para limpiar al final), con cada rol en su propia sesión:
//   Gerencia crea el material, la obra y su presupuesto y lo publica → Logística crea el proveedor y la OC (con
//   guía) y le comparte el link → el proveedor cotiza en el link y vuelve a verlo → Logística confirma los
//   precios → el proveedor ve su orden en el mismo link → Logística registra la factura y la guía (va sola a
//   Tesorería) → Tesorería la rechaza por un dato → Logística la corrige y la reenvía → Tesorería la paga con su
//   voucher → Logística manda la constancia → el proveedor la ve pagada → Gerencia la consulta y el Jefe de
//   Operaciones ve el seguimiento → todo quedó en la auditoría con su autor.
// Y el de una OS con recibo por honorarios: Gerencia agrega el servicio y sube su firma (el Admin le pone el DNI) →
//   Logística emite la OS con su comprobante y la fecha de inicio → el proveedor cotiza → Logística confirma,
//   descarga el contrato, registra el recibo (con la retención de 4ta) y sube el contrato firmado (va sola a
//   Tesorería) → Tesorería paga el neto → el proveedor ve su orden de servicio pagada.

const ARCHIVO = path.resolve("tests/e2e/archivos/ariant.png");
// Al azar, no por la hora: los workers arrancan en el mismo milisegundo y compartían el sufijo (y la limpieza).
const sufijo = String(crypto.randomInt(100000, 1000000));
const OBRA = `E2E FLUJO ${sufijo}`;
const MATERIAL = `E2E CEMENTO FLUJO ${sufijo}`;
const PROVEEDOR = `E2E PROVEEDOR FLUJO ${sufijo}`;
const RUC = `20${sufijo}${String(Date.now() % 1000).padStart(3, "0")}`;
const CANTIDAD = 100;
const PU_PRESUPUESTO = 25;
const PU_PROVEEDOR = 24;
const SERVICIO = `E2E PINTURA FLUJO ${sufijo}`;
const OBRA_OS = `E2E FLUJO OS ${sufijo}`;
const PROVEEDOR_OS = `E2E PROVEEDOR FLUJO OS ${sufijo}`;
const RUC_OS = `10${sufijo}${String((Date.now() + 7) % 1000).padStart(3, "0")}`;
const PU_SERVICIO = 2000;
// RHE de más de S/ 1,500: retiene el 8 % del proveedor (el de un proveedor nuevo).
const RETENCION = PU_SERVICIO * 0.08;
const hoyLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const masDias = (iso: string, d: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + d * 864e5).toISOString().slice(0, 10);
const sol = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uidGerencia = () => sql1(`select u.id from auth.users u where u.email = 'gerencia@erp.local'`);

const estado = (obra: string, numero: string) => sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`);

/** Elige una opción de un SearchSelect (botón con su nombre → lista con buscador). */
async function elegir(page: Page, ambito: Page | ReturnType<Page["locator"]>, campo: string, opcion: string | RegExp) {
  await ambito.getByRole("button", { name: campo, exact: true }).click();
  // El buscador de la lista que se abre (el último: puede haber otro «Buscar …» en la pantalla).
  const buscar = page.getByLabel(`Buscar ${campo}`, { exact: true }).last();
  if (typeof opcion === "string" && (await buscar.count())) await buscar.fill(opcion.slice(0, 30));
  await page.getByRole("listbox", { name: campo }).getByRole("option", { name: opcion }).first().click();
}

/** El proveedor: sin sesión ni contraseña de la demo, solo con su link. */
async function proveedor(browser: Browser, info: { project: { use: object } }, link: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  await page.goto(link);
  return { ctx, page };
}

// Lo del flujo: lo de esta corrida (su sufijo) o lo que dejó una que falló hace más de 30 minutos (por su alta en
// la auditoría). Lo de otro worker que corre a la vez no se toca.
const delFlujo = (tabla: string, columna: string, patron: string) =>
  `select t.id from ${tabla} t where t.${columna} like '${patron}' and (t.${columna} like '%${sufijo}'
     or not exists (select 1 from audit_log a where a.tabla = '${tabla}' and a.accion = 'INSERT' and a.registro = t.id::text
                     and a.created_at > now() - interval '30 minutes'))`;

/** Borra lo del flujo (obras «E2E FLUJO …», sus proveedores y sus ítems). Pagos y comprobantes no llevan la obra:
 *  van por sus aplicaciones y las líneas de la orden. */
function limpiar() {
  for (const [obra] of sql(delFlujo("obras", "nombre", "E2E FLUJO %"))) {
    sql(`set session_replication_role = replica;
         create temp table _comps as select distinct comprobante_id id from oc_items where obra_id = ${obra} and comprobante_id is not null
           union select comprobante_id from pago_aplicaciones where obra_id = ${obra} and comprobante_id is not null;
         -- El pago se aplica al comprobante (su aplicación no lleva la obra).
         create temp table _pagos as select distinct pago_id id from pago_aplicaciones
           where obra_id = ${obra} or comprobante_id in (select id from _comps);
         delete from adjuntos where obra_id = ${obra} or pago_id in (select id from _pagos);
         delete from pago_aplicaciones where pago_id in (select id from _pagos);
         delete from pagos where id in (select id from _pagos);
         delete from rechazos where obra_id = ${obra};
         delete from guias where obra_id = ${obra};
         update oc_items set comprobante_id = null where obra_id = ${obra};
         delete from comprobantes_historial where comprobante_id in (select id from _comps);
         delete from comprobantes where id in (select id from _comps);
         delete from entrega_fotos where entrega_id in (select id from entregas where obra_id = ${obra});
         delete from entregas where obra_id = ${obra};
         delete from oc_items where obra_id = ${obra};
         delete from cotizacion_accesos where obra_id = ${obra};
         delete from ordenes_compra where obra_id = ${obra};
         delete from detracciones where obra_id = ${obra};
         delete from partidas where obra_id = ${obra};
         delete from obra_etapas where obra_id = ${obra};
         delete from perfil_obras where obra_id = ${obra};
         delete from notificaciones where href like '%/${obra}/%' or href like '%/obras/${obra}%';
         delete from obras where id = ${obra};`);
  }
  const proveedores = delFlujo("proveedores", "razon_social", "E2E PROVEEDOR FLUJO %");
  sql(`set session_replication_role = replica;
       create temp table _prov as ${proveedores};
       delete from proveedor_contactos where proveedor_id in (select id from _prov);
       delete from proveedor_cuentas where proveedor_id in (select id from _prov);
       delete from proveedor_tipos_material where proveedor_id in (select id from _prov);
       delete from proveedores where id in (select id from _prov);
       delete from items where id in (${delFlujo("items", "descripcion", "E2E CEMENTO FLUJO %")})
          or id in (${delFlujo("items", "descripcion", "E2E PINTURA FLUJO %")});`);
}

type Abrir = (rol: "gerencia" | "logistica", ruta: string) => Promise<Page>;

/** Gerencia: la obra (de ARIANT) con una partida del ítem, y el presupuesto publicado. Devuelve su id. */
async function crearObra(abrir: Abrir, nombre: string, item: string, cantidad: number, pu: number) {
  const page = await abrir("gerencia", "/gerencia/obras");
  await page.getByRole("button", { name: "Nueva obra" }).click();
  const hoja = page.getByRole("dialog", { name: "Nueva obra" });
  await hoja.getByLabel("Nombre").fill(nombre);
  await elegir(page, hoja, "Empresa", "ARIANT");
  await hoja.getByLabel("Dirección").fill("Av. de Prueba 123, Lima");
  await hoja.getByRole("button", { name: "Crear obra" }).click();
  await page.waitForURL(/\/gerencia\/obras\/\d+/);
  const id = page.url().match(/\/gerencia\/obras\/(\d+)/)![1];

  await page.getByRole("button", { name: "Partida", exact: true }).click();
  const partida = page.getByRole("dialog", { name: "Partida nueva" });
  await elegir(page, partida, "Ítem", item);
  await partida.getByLabel("Cantidad").fill(String(cantidad));
  await partida.getByLabel("P.U.").fill(String(pu));
  await partida.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: /^Guardar cambios/ }).click();
  await expect.poll(() => sql1(`select count(*) from partidas where obra_id = ${id}`)).toBe("1");

  await page.getByRole("button", { name: "Publicar presupuesto" }).click();
  await page.getByRole("dialog", { name: "¿Publicar el presupuesto?" }).getByRole("button", { name: "Sí" }).click();
  await expect.poll(() => sql1(`select presupuesto_estado from obras where id = ${id}`)).toBe("PUBLICADO");
  return { id, page };
}

/** Logística: el proveedor con un contacto y su comprobante habitual. */
async function crearProveedor(abrir: Abrir, razon: string, ruc: string, comprobante: RegExp) {
  const page = await abrir("logistica", "/logistica/proveedores");
  await page.getByRole("button", { name: "Nuevo proveedor" }).click();
  const hoja = page.getByRole("dialog", { name: "Nuevo proveedor" });
  await hoja.getByLabel("RUC / DNI").fill(ruc);
  await hoja.getByLabel("Razón social").fill(razon);
  await hoja.getByRole("button", { name: "Agregar contacto" }).click();
  await hoja.getByLabel("Nombre del contacto").first().fill("Carlos Prueba");
  await hoja.getByLabel("Teléfono").first().fill("987654321");
  await elegir(page, hoja, "Comprobante habitual", comprobante);
  await hoja.getByRole("button", { name: "Guardar" }).click();
  await expect(hoja).toBeHidden();
  expect(sql1(`select ruc_o_cod from proveedores where razon_social = '${razon}'`)).toBe(ruc);
}

test.describe("@flujo flujo completo por las pantallas", () => {
  // La OC y la OS, cada una con su obra y su proveedor: corren a la vez.

  // Limpieza (solo esto va por SQL): lo que creó el flujo, también lo que dejara una corrida anterior que falló.
  // La firma y el DNI de Gerencia (los pone la prueba de la OS) vuelven a como estaban.
  let gerenciaAntes: string[] | undefined;
  test.beforeAll(() => {
    limpiar();
    gerenciaAntes = sql(`select coalesce(dni, ''), coalesce(firma_path, '') from perfil_privado where user_id = '${uidGerencia()}'`)[0];
  });
  test.afterAll(() => {
    limpiar();
    const uid = uidGerencia();
    sql(
      gerenciaAntes
        ? `update perfil_privado set dni = ${gerenciaAntes[0] ? `'${gerenciaAntes[0]}'` : "null"}, firma_path = ${gerenciaAntes[1] ? `'${gerenciaAntes[1]}'` : "null"} where user_id = '${uid}'`
        : `delete from perfil_privado where user_id = '${uid}'`,
    );
  });

  test("OC: de la obra al pago y la constancia", async ({ abrir, browser, revisarPantalla }, info) => {
    test.setTimeout(240_000);
    let link = "";
    let obraId = "";
    let numero = "";

    await test.step("Gerencia crea el material", async () => {
      const page = await abrir("gerencia", "/gerencia/items");
      await page.getByRole("button", { name: "Nuevo material" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo material" });
      await hoja.getByLabel("Descripción").fill(MATERIAL);
      await hoja.getByRole("button", { name: "Unidad", exact: true }).click();
      await page.getByRole("listbox", { name: "Unidad" }).getByRole("option", { name: "BLS", exact: true }).click();
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql1(`select rubro || ' ' || unidad from items where descripcion = '${MATERIAL}'`)).toBe("MATERIAL BLS");
    });

    await test.step("Gerencia crea la obra, arma su presupuesto y lo publica", async () => {
      const r = await crearObra(abrir, OBRA, MATERIAL, CANTIDAD, PU_PRESUPUESTO);
      obraId = r.id;
      await revisarPantalla(r.page);
    });

    await test.step("Logística crea el proveedor", async () => {
      await crearProveedor(abrir, PROVEEDOR, RUC, /^Factura/);
    });

    await test.step("Logística crea la OC (con guía) para la obra", async () => {
      const page = await abrir("logistica", "/logistica/ordenes/nueva?tipo=OC");
      await elegir(page, page.locator("main"), "Obra", OBRA);
      await page.getByPlaceholder("Buscar partida").fill(MATERIAL);
      await page.locator("main label").filter({ hasText: MATERIAL }).first().locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: /^Continuar/ }).click();
      const main = page.locator("main");
      await elegir(page, main, "Proveedor", PROVEEDOR);
      await main.getByLabel("Requiere guía de remisión").check();
      await page.getByRole("button", { name: "Confirmar" }).click();
      await page.getByRole("dialog").filter({ hasText: /^¿Emitir OC/ }).getByRole("button", { name: "Sí" }).click();
      await page.waitForURL(new RegExp(`/logistica/ordenes/${obraId}/`));
      numero = decodeURIComponent(page.url().match(new RegExp(`/logistica/ordenes/${obraId}/([^?]+)`))![1]);
      expect(estado(obraId, numero)).toBe("EMITIDA");
      expect(sql1(`select requiere_guia from ordenes_compra where obra_id = ${obraId} and numero = '${numero}'`)).toBe("t");
    });

    await test.step("Logística copia el link de cotización", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${numero}?tipo=OC`);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Copiar" }).click();
      await expect(page.getByText("Link copiado")).toBeVisible();
      link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toMatch(/\/cotizar\/[0-9a-f-]{36}$/);
      await expect.poll(() => sql1(`select cotizacion_estado from ordenes_compra where obra_id = ${obraId} and numero = '${numero}'`)).toBe("ENVIADA");
    });

    await test.step("El proveedor cotiza en su link y vuelve a verlo", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.getByRole("heading", { name: `OC ${numero}` })).toBeVisible();
      await expect(page.getByText("ARIANT")).toBeVisible();
      // No ve el precio del presupuesto.
      await expect(page.getByText(`S/ ${PU_PRESUPUESTO}.00`)).toHaveCount(0);
      await page.getByLabel(`Precio unitario ${MATERIAL}`).fill(String(PU_PROVEEDOR));
      await expect(page.getByText(`S/ ${(PU_PROVEEDOR * CANTIDAD).toLocaleString("en-US")}.00`).last()).toBeVisible();
      await page.getByRole("button", { name: "Enviar cotización" }).click();
      await expect(page.getByRole("status")).toHaveText("Cotización enviada");
      // Vuelve a entrar: ve lo que mandó, sin poder cambiarlo.
      await page.reload();
      await expect(page.getByRole("status")).toHaveText("Cotización enviada");
      await expect(page.getByLabel(`Precio unitario ${MATERIAL}`)).toHaveCount(0);
      await expect(page.getByText(`S/ ${PU_PROVEEDOR}.00`)).toBeVisible();
      await ctx.close();
      expect(sql1(`select cotizacion_estado from ordenes_compra where obra_id = ${obraId} and numero = '${numero}'`)).toBe("RECIBIDA");
    });

    await test.step("Logística confirma los precios del proveedor", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${numero}?tipo=OC`);
      await page.getByRole("button", { name: "Confirmar precios" }).click();
      await page.getByRole("dialog", { name: "¿Confirmar precios?" }).getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => estado(obraId, numero)).toBe("PRECIOS_CONFIRMADOS");
    });

    await test.step("El proveedor ve su orden de compra en el mismo link", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.getByRole("heading", { name: `OC ${numero}` })).toBeVisible();
      await expect(page.locator("header")).toContainText("Orden de compra");
      await expect(page.locator("header")).toContainText("Confirmada");
      await expect(page.getByText(`S/ ${PU_PROVEEDOR}.00`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Enviar cotización" })).toHaveCount(0);
      await revisarPantalla(page);
      await ctx.close();
    });

    await test.step("Logística registra la factura y la guía: va sola a Tesorería", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${numero}?tipo=OC`);
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = page.getByRole("dialog", { name: "Comprobante" });
      await expect(hoja.getByLabel("Requiere guía de remisión")).toBeChecked();
      await hoja.getByLabel("Serie").fill("F001");
      await hoja.getByLabel("Número").fill(sufijo);
      await hoja.locator('input[type="file"]').setInputFiles(ARCHIVO);
      await hoja.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(hoja).toBeHidden();
      await expect.poll(() => estado(obraId, numero)).toBe("FACTURADA");

      const seccion = page.locator("section").filter({ has: page.getByText("Guía de remisión", { exact: true }) });
      await seccion.getByRole("button", { name: "Registrar guía" }).click();
      const guia = page.getByRole("dialog", { name: "Registrar guía" });
      await guia.getByLabel("N° de guía").fill(`T001-${sufijo}`);
      await guia.getByLabel("Guía (PDF o foto)").setInputFiles(ARCHIVO);
      await expect(guia.getByText("ariant.png")).toBeVisible();
      // El traslado: lo más común, el proveedor con su unidad.
      await guia.getByLabel("Placa").fill("ABC-123");
      await guia.getByLabel("N° licencia").fill("Q12345678");
      await guia.getByLabel("Punto de partida").fill("Almacén del proveedor, Lima");
      await guia.getByLabel("Punto de llegada").fill("Av. de Prueba 123, Lima");
      await expect(guia.getByRole("button", { name: "Registrar guía" })).toBeEnabled({ timeout: 15_000 });
      await guia.getByRole("button", { name: "Registrar guía" }).click();
      await expect(guia).toBeHidden();
      await expect.poll(() => estado(obraId, numero)).toBe("EN_TESORERIA");
    });

    await test.step("Tesorería la rechaza por un dato; Logística lo corrige y la reenvía", async () => {
      const tes = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${numero}`);
      await tes.getByRole("button", { name: "Rechazar", exact: true }).click();
      const hoja = tes.locator("dialog[open]").last();
      await hoja.getByRole("radio", { name: /^Datos o documentos/ }).check();
      await hoja.getByLabel("Motivo").fill("Falta la cuenta bancaria del proveedor");
      await hoja.getByRole("button", { name: "Rechazar", exact: true }).click();
      await tes.waitForURL((u) => u.pathname === "/tesoreria");
      expect(estado(obraId, numero)).toBe("FACTURADA");

      const log = await abrir("logistica", `/logistica/ordenes/${obraId}/${numero}?tipo=OC`);
      await expect(log.getByRole("alert").filter({ hasText: "Rechazada por Tesorería" })).toContainText("Falta la cuenta bancaria");
      await log.getByRole("button", { name: "Reenviar a Tesorería" }).click();
      const confirmar = log.getByRole("dialog").filter({ hasText: "¿Reenviar a Tesorería?" });
      await confirmar.getByLabel("Qué se corrigió").fill("Se agregó la cuenta del proveedor");
      await confirmar.getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => estado(obraId, numero)).toBe("EN_TESORERIA");
    });

    await test.step("El proveedor ve su orden en pago", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.locator("header")).toContainText("En pago");
      await ctx.close();
    });

    await test.step("Tesorería la ve «Reenviada» y la paga con su voucher", async () => {
      const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${numero}`);
      await expect(page.getByRole("region", { name: "Reenviada" })).toContainText("Se agregó la cuenta del proveedor");
      await expect(page.getByRole("textbox", { name: "Monto", exact: true })).toHaveValue(`S/ ${(PU_PROVEEDOR * CANTIDAD).toLocaleString("en-US")}.00`);
      await elegir(page, page.locator("main"), "Banco", "BCP");
      await page.getByRole("textbox", { name: "N° de operación", exact: true }).fill(`OP${sufijo}`);
      await page.locator('main input[type="file"]').setInputFiles(ARCHIVO);
      await page.getByRole("button", { name: "Aprobar pago" }).click();
      await page.getByRole("dialog", { name: "¿Aprobar pago?" }).getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => estado(obraId, numero), { timeout: 15_000 }).toBe("PAGADA");
      expect(sql1(`select monto from pagos where numero_operacion = 'OP${sufijo}'`)).toBe(`${PU_PROVEEDOR * CANTIDAD}.00`);
    });

    await test.step("El proveedor ve su orden pagada, con el pago y su voucher (solo para ver)", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.locator("header")).toContainText("Pagada");
      const pagos = page.getByRole("region", { name: "Pagos" });
      await expect(pagos).toContainText(`Op. OP${sufijo}`);
      await expect(pagos).toContainText(sol(PU_PROVEEDOR * CANTIDAD));
      const voucher = await page.request.get(await pagos.getByRole("link", { name: /^Ver voucher/ }).getAttribute("href").then((h) => h!));
      expect(voucher.status()).toBe(200);
      expect(voucher.headers()["content-type"]).toMatch(/^image\//);
      await expect(page.getByText(/^Disponible hasta el \d{2}\/\d{2}\/\d{2,4}$/)).toBeVisible();
      // Nada se sube desde el link, ni se ve lo interno (presupuesto, rechazos).
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("Falta la cuenta bancaria");
      await expect(page.getByText(sol(PU_PRESUPUESTO))).toHaveCount(0);
      await ctx.close();
    });

    await test.step("Logística le manda la constancia de pago", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${numero}?tipo=OC`);
      // WhatsApp se abre en otra ventana: se cierra.
      page.context().on("page", (p) => void p.close().catch(() => {}));
      await page.locator("details").filter({ has: page.locator("summary", { hasText: "Constancia de pago" }) }).getByRole("button", { name: "WhatsApp" }).click();
      await expect.poll(() => estado(obraId, numero)).toBe("EN_ENTREGA");
    });

    await test.step("El proveedor la ve con la constancia enviada", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.locator("header")).toContainText("Pagada · constancia enviada");
      await expect(page.getByText(`S/ ${PU_PROVEEDOR}.00`)).toBeVisible();
      await ctx.close();
    });

    await test.step("Gerencia la consulta y el Jefe de Operaciones ve el seguimiento", async () => {
      const ger = await abrir("gerencia", `/consulta/orden/${obraId}/${numero}`);
      await expect(ger.locator("main")).toContainText(PROVEEDOR);
      await expect(ger.locator("main")).toContainText(`T001-${sufijo}`);
      await revisarPantalla(ger);
      const jefe = await abrir("jefe", `/operaciones?grupo=MATERIALES&obra=${obraId}`);
      const fila = jefe.locator("main li").filter({ hasText: MATERIAL });
      await expect(fila).toContainText("Pagado sin entregar");
      await expect(fila).toContainText(String(CANTIDAD));
    });

    await test.step("El link vence 15 días después del pago", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      const href = await page.getByRole("region", { name: "Pagos" }).getByRole("link", { name: /^Ver voucher/ }).getAttribute("href");
      // Se simula el paso del tiempo: el pago, de hace 16 días.
      sql(`update pagos set created_at = now() - interval '16 days' where numero_operacion = 'OP${sufijo}'`);
      await page.reload();
      await expect(page.getByText("Este link ya no está disponible")).toBeVisible();
      expect((await page.request.get(href!)).status()).toBe(404);
      sql(`update pagos set created_at = now() where numero_operacion = 'OP${sufijo}'`);
      await ctx.close();
    });

    await test.step("Todo quedó en la auditoría con su autor", async () => {
      // El autor por su correo (puede haber otros usuarios con el mismo rol, p. ej. de otra prueba).
      const CORREO: Record<string, string> = { GERENCIA: ROLES.gerencia, LOGISTICA: ROLES.logistica, TESORERIA: ROLES.tesoreria };
      const autor = (rol: string) => sql1(`select id from auth.users where email = '${CORREO[rol]}'`);
      const hay = (tabla: string, accion: string, rol: string, donde: string) =>
        Number(sql1(`select count(*) from audit_log where tabla = '${tabla}' and accion = '${accion}' and user_id = '${autor(rol)}' and ${donde}`));
      expect(hay("obras", "INSERT", "GERENCIA", `registro = '${obraId}'`), "Gerencia creó la obra").toBe(1);
      expect(hay("partidas", "INSERT", "GERENCIA", `detalle->>'obra_id' = '${obraId}'`), "Gerencia cargó la partida").toBe(1);
      expect(hay("ordenes_compra", "INSERT", "LOGISTICA", `registro = '${obraId}/${numero}'`), "Logística creó la OC").toBe(1);
      expect(hay("rechazos", "INSERT", "TESORERIA", `detalle->>'obra_id' = '${obraId}'`), "Tesorería la rechazó").toBe(1);
      expect(hay("pagos", "INSERT", "TESORERIA", `detalle->>'numero_operacion' = 'OP${sufijo}'`), "Tesorería la pagó").toBe(1);
    });
  });

  test("OS con recibo por honorarios: contrato firmado, retención y pago del neto", async ({ abrir, browser }, info) => {
    test.setTimeout(240_000);
    let link = "";
    let os = "";
    let obraId = "";

    await test.step("Gerencia crea el servicio, la obra con él y publica el presupuesto", async () => {
      const items = await abrir("gerencia", "/gerencia/items?clase=serv");
      await items.getByRole("button", { name: "Nuevo servicio" }).click();
      const hoja = items.getByRole("dialog", { name: "Nuevo servicio" });
      await hoja.getByLabel("Descripción").fill(SERVICIO);
      await elegir(items, hoja, "Unidad", "GLB");
      await elegir(items, hoja, "Rubro", "SUBCONTRATO");
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql1(`select rubro from items where descripcion = '${SERVICIO}'`)).toBe("SUBCONTRATO");

      obraId = (await crearObra(abrir, OBRA_OS, SERVICIO, 1, 2500)).id;
    });

    await test.step("Logística crea el proveedor (recibo por honorarios)", async () => {
      await crearProveedor(abrir, PROVEEDOR_OS, RUC_OS, /^Recibo por honorarios/);
    });

    await test.step("Gerencia sube su firma y el Admin le pone el DNI", async () => {
      const page = await abrir("gerencia", "/gerencia/obras");
      await page.getByRole("button", { name: "Usuario" }).click();
      await page.getByRole("button", { name: "Mi firma" }).click();
      const hoja = page.getByRole("dialog", { name: "Mi firma" });
      await hoja.locator('input[type="file"]').setInputFiles(ARCHIVO);
      await hoja.getByRole("button", { name: "Guardar firma" }).click();
      await expect(hoja).toBeHidden();

      const admin = await abrir("admin", "/admin");
      await admin.locator("main").getByRole("button", { name: /(^|[^\w-])gerencia@erp\.local/ }).click();
      const ficha = admin.getByRole("dialog", { name: "Gerencia" });
      await ficha.getByLabel("DNI").fill("41234567");
      await ficha.getByRole("button", { name: "Guardar" }).click();
      await expect(ficha).toBeHidden();
      expect(sql1(`select dni || ' ' || (firma_path is not null) from perfil_privado where user_id = '${uidGerencia()}'`)).toBe("41234567 true");
    });

    await test.step("Logística emite la OS con recibo por honorarios y la fecha de inicio", async () => {
      const page = await abrir("logistica", "/logistica/ordenes/nueva?tipo=OS");
      await elegir(page, page.locator("main"), "Obra", OBRA_OS);
      await page.getByPlaceholder("Buscar partida").fill(SERVICIO);
      await page.locator("main label").filter({ hasText: SERVICIO }).first().locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: /^Continuar/ }).click();
      const main = page.locator("main");
      await elegir(page, main, "Proveedor", PROVEEDOR_OS);
      await elegir(page, main, "Comprobante", "Recibo por honorarios");
      await main.getByLabel("Fecha de inicio").fill(masDias(hoyLima(), -3));
      await page.getByRole("button", { name: "Confirmar" }).click();
      await page.getByRole("dialog").filter({ hasText: /^¿Emitir OS/ }).getByRole("button", { name: "Sí" }).click();
      await page.waitForURL(new RegExp(`/logistica/ordenes/${obraId}/`));
      os = decodeURIComponent(page.url().match(new RegExp(`/logistica/ordenes/${obraId}/([^?]+)`))![1]);
      expect(sql1(`select tipo || ' ' || comprobante_tipo from ordenes_compra where obra_id = ${obraId} and numero = '${os}'`)).toBe("OS RXH");
    });

    await test.step("El proveedor cotiza la OS y Logística confirma", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${os}?tipo=OS`);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Copiar" }).click();
      await expect(page.getByText("Link copiado")).toBeVisible();
      link = await page.evaluate(() => navigator.clipboard.readText());

      const prov = await proveedor(browser, info, link);
      await expect(prov.page.getByRole("heading", { name: `OS ${os}` })).toBeVisible();
      await prov.page.getByLabel(`Precio unitario ${SERVICIO}`).fill(String(PU_SERVICIO));
      await prov.page.getByRole("button", { name: "Enviar cotización" }).click();
      await expect(prov.page.getByRole("status")).toHaveText("Cotización enviada");
      await prov.ctx.close();

      await page.reload();
      await page.getByRole("button", { name: "Confirmar precios" }).click();
      await page.getByRole("dialog", { name: "¿Confirmar precios?" }).getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => estado(obraId, os)).toBe("PRECIOS_CONFIRMADOS");
    });

    await test.step("El proveedor descarga desde su link el contrato para firmar (y no puede subirlo ahí)", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      const enlace = page.getByRole("region", { name: "Contrato" }).getByRole("link", { name: "Contrato para firmar" });
      await expect(enlace).toBeVisible();
      const pdf = await page.request.get((await enlace.getAttribute("href"))!);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await ctx.close();
    });

    await test.step("Logística descarga el contrato, registra el recibo y sube el firmado: va sola a Tesorería", async () => {
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${os}?tipo=OS`);
      const contrato = page.getByRole("region", { name: "Contrato" });
      // Con el logo de la empresa arriba (la obra es de ARIANT).
      const logo = page.waitForResponse((r) => /\/empresas\/pdf\/ariant\.png$/.test(r.url()));
      const [descarga] = await Promise.all([page.waitForEvent("download"), contrato.getByRole("button", { name: "Descargar" }).click()]);
      expect(descarga.suggestedFilename()).toMatch(/^Contrato-OS-/);
      expect((await logo).status()).toBe(200);
      if (process.env.GUARDAR_CONTRATO) await descarga.saveAs(process.env.GUARDAR_CONTRATO);

      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = page.getByRole("dialog", { name: "Comprobante" });
      await expect(hoja.getByRole("button", { name: "Tipo de comprobante" })).toHaveText(/Recibo por honorarios/);
      await hoja.getByLabel("Serie").fill("E001");
      await hoja.getByLabel("Número").fill(sufijo);
      await hoja.getByLabel("Total").fill(String(PU_SERVICIO));
      await expect(hoja.getByLabel("Retención 4ta (8 %)")).toHaveAttribute("placeholder", RETENCION.toFixed(2));
      await hoja.locator('input[type="file"]').setInputFiles(ARCHIVO);
      await hoja.getByRole("button", { name: /^Registrar/ }).click();
      await expect(hoja).toBeHidden();
      await expect.poll(() => estado(obraId, os)).toBe("FACTURADA");

      await page.locator('#contrato input[type="file"]').setInputFiles(ARCHIVO);
      await expect.poll(() => estado(obraId, os), { timeout: 15_000 }).toBe("EN_TESORERIA");
    });

    await test.step("Tesorería paga el neto (total menos la retención)", async () => {
      const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${os}`);
      await expect(page.getByRole("textbox", { name: "Monto", exact: true })).toHaveValue(sol(PU_SERVICIO - RETENCION));
      await elegir(page, page.locator("main"), "Banco", "BCP");
      await page.getByRole("textbox", { name: "N° de operación", exact: true }).fill(`OS${sufijo}`);
      await page.locator('main input[type="file"]').setInputFiles(ARCHIVO);
      await page.getByRole("button", { name: "Aprobar pago" }).click();
      await page.getByRole("dialog", { name: "¿Aprobar pago?" }).getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => estado(obraId, os), { timeout: 15_000 }).toBe("PAGADA");
      expect(sql1(`select monto from pagos where numero_operacion = 'OS${sufijo}'`)).toBe((PU_SERVICIO - RETENCION).toFixed(2));
      expect(
        sql1(`select c.retencion from comprobantes c where c.id = (select comprobante_id from oc_items where obra_id = ${obraId} and numero_oc = '${os}' limit 1)`),
      ).toBe(RETENCION.toFixed(2));
    });

    await test.step("El proveedor ve su orden de servicio pagada: la retención, el voucher y el contrato firmado", async () => {
      const { ctx, page } = await proveedor(browser, info, link);
      await expect(page.locator("header")).toContainText("Orden de servicio");
      await expect(page.locator("header")).toContainText("Pagada");
      await expect(page.locator("main")).toContainText(`Retención 4ta− ${sol(RETENCION)}`);
      await expect(page.getByRole("region", { name: "Pagos" })).toContainText(sol(PU_SERVICIO - RETENCION));
      const firmado = page.getByRole("region", { name: "Contrato" }).getByRole("link", { name: "Contrato firmado" });
      const r = await page.request.get((await firmado.getAttribute("href"))!);
      expect(r.status()).toBe(200);
      // Otro token u otro voucher: nada.
      expect((await page.request.get(`/cotizar/${crypto.randomUUID()}/archivo?tipo=contrato`)).status()).toBe(404);
      expect((await page.request.get(`${link}/archivo?tipo=voucher&id=1`)).status()).toBe(404);
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      if (process.env.CAPTURA_PROVEEDOR) await page.screenshot({ path: process.env.CAPTURA_PROVEEDOR, fullPage: true });
      await ctx.close();
    });
  });
});
