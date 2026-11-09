import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe, uidSql } from "./lib";

// Detracciones (Gerencia las marca, Logística las ve al facturar, Tesorería paga el neto), rechazo con
// factura nueva e historial de rechazos, y el pago visible en las etapas siguientes de la orden.
// Lo que se escribe en la base se revierte en la misma prueba.

const dinero = (n: number) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test.describe("@pagos @gerencia detracciones en el presupuesto", () => {
  test("agregar un ítem con detracción toma 5 %, se guarda y se puede quitar", async ({ abrir, revisarPantalla }, info) => {
    // Una obra de la carga (no una que otra prueba esté creando en paralelo).
    const [obraId] = sql("select id from obras where estado <> 'CERRADA' and presupuesto_estado = 'PUBLICADO' and nombre not like 'E2E %' and nombre not like 'AUDIT%' order by id desc limit 1")[0];
    // Un ítem distinto por proyecto (corren en paralelo).
    const salto = info.project.name === "m360" ? 1 : 0;
    const [itemId, descripcion] = sql(
      `select i.id, i.descripcion from items i where i.id in (select item_id from partidas where obra_id = ${obraId})
         and not exists (select 1 from detracciones d where d.obra_id = ${obraId} and d.item_id = i.id)
       order by i.descripcion limit 1 offset ${salto}`,
    )[0];
    try {
      const page = await abrir("gerencia", `/gerencia/obras/${obraId}`);
      const seccion = page.getByRole("region", { name: "Detracciones" });
      await seccion.getByRole("button", { name: "Agregar ítem con detracción" }).click();
      const hoja = page.locator("dialog[open]").last();
      await hoja.locator("input[type=search]").fill(descripcion.slice(0, 25));
      await hoja.getByRole("option", { name: descripcion, exact: true }).first().click();
      const campo = seccion.getByRole("spinbutton", { name: `Detracción de ${descripcion}`, exact: true });
      await expect(campo).toHaveValue("5");
      await campo.fill("4");
      await seccion.getByRole("button", { name: "Guardar detracciones" }).click();
      await expect.poll(() => sql1(`select porcentaje from detracciones where obra_id = ${obraId} and item_id = ${itemId}`), { timeout: 15_000 }).toBe("4.00");
      await revisarPantalla(page);
      await seccion.getByRole("button", { name: `Quitar la detracción de ${descripcion}` }).click();
      await seccion.getByRole("button", { name: "Guardar detracciones" }).click();
      await expect.poll(() => sql1(`select count(*) from detracciones where obra_id = ${obraId} and item_id = ${itemId}`), { timeout: 15_000 }).toBe("0");
    } finally {
      sql(`delete from detracciones where obra_id = ${obraId} and item_id = ${itemId}`);
    }
  });
});

test.describe("@pagos @gerencia mínimo de la detracción", () => {
  test("Gerencia cambia desde qué monto una factura lleva detracción", async ({ abrir, revisarPantalla }) => {
    const antes = sql1("select detraccion_minimo from parametros");
    try {
      const page = await abrir("gerencia", "/gerencia/obras");
      await page.getByRole("button", { name: /Detracción desde/ }).click();
      const hoja = page.locator("dialog[open]").last();
      await hoja.getByRole("spinbutton").fill(String(Number(antes) + 50));
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect.poll(() => sql1("select detraccion_minimo from parametros"), { timeout: 15_000 }).toBe((Number(antes) + 50).toFixed(2));
      await revisarPantalla(page);
    } finally {
      sql(`update parametros set detraccion_minimo = ${antes}`);
    }
  });
});

test.describe("@pagos @logistica detracción al registrar la factura", () => {
  test("la factura con ítems que llevan detracción la propone calculada", async ({ abrir }, info) => {
    const salto = info.project.name === "m360" ? 1 : 0;
    const [obraId, numero] = sql(
      `select o.obra_id, o.numero from ordenes_compra o join proveedores p on p.id = o.proveedor_id
        where o.estado = 'PRECIOS_CONFIRMADOS' and o.tipo = 'OC'
          and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is null)
          and (select sum(c.parcial) from v_oc_items_calc c where c.obra_id = o.obra_id and c.numero_oc = o.numero and c.comprobante_id is null)
              > (select detraccion_minimo from parametros) + 500
        order by o.obra_id, o.numero limit 1 offset ${salto}`,
    )[0];
    const [itemId] = sql(
      `select p.item_id from oc_items l join partidas p on p.id = l.partida_id
        where l.obra_id = ${obraId} and l.numero_oc = '${numero}' and l.comprobante_id is null order by l.id limit 1`,
    )[0];
    sql(`insert into detracciones (obra_id, item_id, porcentaje) values (${obraId}, ${itemId}, 10) on conflict do nothing`);
    try {
      // Sugerida con el total por defecto (la suma de las líneas): Σ parcial × % ÷ 100.
      const sugerida = Number(
        sql1(
          `select round(sum(coalesce(c.parcial,0) * coalesce(d.porcentaje,0)) / 100, 2) from v_oc_items_calc c
             left join detracciones d on d.obra_id = c.obra_id and d.item_id = c.item_id
            where c.obra_id = ${obraId} and c.numero_oc = '${numero}' and c.comprobante_id is null`,
        ),
      );
      const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${encodeURIComponent(numero)}`);
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = page.locator("dialog[open]").last();
      const tipo = hoja.getByRole("button", { name: "Tipo de comprobante" });
      if (!(await tipo.innerText()).includes("Factura")) {
        await tipo.click();
        await page.locator("dialog[open]").last().getByRole("option", { name: "Factura", exact: true }).click();
      }
      await expect(hoja.getByLabel("Detracción")).toHaveAttribute("placeholder", dinero(sugerida));
      // Con un total que no supera el mínimo, la factura no lleva detracción (S/ 1: bajo cualquier mínimo,
      // aunque otra prueba lo esté cambiando en paralelo).
      await hoja.getByLabel("Total").fill("1");
      await expect(hoja.getByLabel("Detracción")).toHaveCount(0);
    } finally {
      sql(`delete from detracciones where obra_id = ${obraId} and item_id = ${itemId}`);
    }
  });
});

test.describe("@pagos @tesoreria pago neto y rechazo", () => {
  test("Tesorería ve la detracción y paga el total menos ella", async ({ abrir }, info) => {
    const salto = info.project.name === "m360" ? 1 : 0;
    const [obraId, numero, compId, total] = sql(
      `select l.obra_id, l.numero_oc, c.id, c.total from oc_items l join comprobantes c on c.id = l.comprobante_id
         join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
        where o.estado = 'EN_TESORERIA' and c.tipo = 'FACTURA' and c.retencion = 0 and c.detraccion = 0
          and not exists (select 1 from pago_aplicaciones ap where ap.comprobante_id = c.id)
          and (select count(distinct comprobante_id) from oc_items x where x.obra_id = l.obra_id and x.numero_oc = l.numero_oc) = 1
        group by 1, 2, 3, 4 order by 1, 2 limit 1 offset ${salto}`,
    )[0];
    const detraccion = Math.round(Number(total) * 0.04 * 100) / 100;
    sql(`update comprobantes set detraccion = ${detraccion} where id = ${compId}`);
    try {
      const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
      // Sale en el total de la orden y en su comprobante.
      await expect(page.getByText(`− S/ ${dinero(detraccion)}`).first()).toBeVisible();
      const saldo = Number(sql1(`select saldo from v_por_pagar where obra_id = ${obraId} and numero = '${numero}'`));
      expect(saldo).toBeCloseTo(Number(total) - detraccion, 2);
    } finally {
      sql(`update comprobantes set detraccion = 0 where id = ${compId}`);
    }
  });

  test("al rechazar se elige qué corregir (lo mínimo por defecto: datos o documentos) y el motivo es obligatorio", async ({ abrir }) => {
    const [obraId, numero] = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.estado = 'EN_TESORERIA'
          and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
          -- Que la factura se pueda anular: sin pagos, sin asiento y solo de esta orden.
          and not exists (select 1 from oc_items l join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
          and not exists (select 1 from oc_items l join asientos a on a.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
          and not exists (select 1 from oc_items l join oc_items x on x.comprobante_id = l.comprobante_id
                           where l.obra_id = o.obra_id and l.numero_oc = o.numero and (x.obra_id, x.numero_oc) <> (o.obra_id, o.numero))
        order by o.obra_id desc, o.numero limit 1`,
    )[0];
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    await page.getByRole("button", { name: "Rechazar", exact: true }).click();
    const hoja = page.locator("dialog[open]").last();
    const opciones = hoja.getByRole("region", { name: "Qué hay que corregir" }).getByRole("radio");
    await expect(opciones).toHaveCount(3);
    await expect(hoja.getByRole("radio", { name: /^Datos o documentos/ })).toBeChecked();
    for (const o of [/^La factura/, /^Los precios/]) await expect(hoja.getByRole("radio", { name: o })).toBeEnabled();
    const rechazar = hoja.getByRole("button", { name: "Rechazar", exact: true });
    await expect(rechazar, "sin motivo no se rechaza").toBeDisabled();
    await hoja.getByLabel("Motivo").fill("Corregir");
    await expect(rechazar).toBeEnabled();
  });

  test("si la factura ya tiene pagos, el rechazo no ofrece anularla", async ({ abrir }) => {
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.estado = 'EN_TESORERIA'
          and exists (select 1 from oc_items l join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id
                       where l.obra_id = o.obra_id and l.numero_oc = o.numero) limit 1`,
    )[0];
    test.skip(!fila, "ninguna orden en Tesorería con pagos parciales");
    const [obraId, numero] = fila;
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    await page.getByRole("button", { name: "Rechazar", exact: true }).click();
    const hoja = page.locator("dialog[open]").last();
    await expect(hoja.getByText("La factura ya tiene pagos: solo se puede pedir corregir datos o documentos.")).toBeVisible();
    await expect(hoja.getByRole("radio", { name: /^Datos o documentos/ })).toBeEnabled();
    await expect(hoja.getByRole("radio", { name: /^La factura/ })).toBeDisabled();
    await expect(hoja.getByRole("radio", { name: /^Los precios/ })).toBeDisabled();
  });

  test("cada corrección devuelve la orden solo hasta donde hace falta (y la factura se anula si es la factura o los precios)", () => {
    // En una transacción que se revierte: solo se comprueba la función.
    const r = sqlScript(
      `begin;
       create temp table caso on commit drop as select o.obra_id, o.numero from ordenes_compra o where o.estado = 'EN_TESORERIA'
          and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
          and not exists (select 1 from oc_items l join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
          and not exists (select 1 from oc_items l join asientos a on a.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
        limit 1;
       select set_config('request.jwt.claims', '{"sub":"' || ${uidSql("TESORERIA")} || '","role":"authenticated"}', true) is null;
       savepoint s;
       select rechazar_documento(obra_id, numero, null, 'prueba', false, 'DATOS') from caso;
       select 'DATOS', (select estado::text from ordenes_compra o join caso c using (obra_id) where o.numero = c.numero),
              (select count(*) from oc_items l join caso c on l.obra_id = c.obra_id and l.numero_oc = c.numero where l.comprobante_id is not null);
       rollback to savepoint s;
       select rechazar_documento(obra_id, numero, null, 'prueba', true, 'FACTURA') from caso;
       select 'FACTURA', (select estado::text from ordenes_compra o join caso c using (obra_id) where o.numero = c.numero),
              (select count(*) from oc_items l join caso c on l.obra_id = c.obra_id and l.numero_oc = c.numero where l.comprobante_id is not null),
              (select cardinality(comprobantes_anulados) || ' ' || correccion from rechazos r join caso c on r.obra_id = c.obra_id and r.numero = c.numero order by r.id desc limit 1);
       rollback to savepoint s;
       select rechazar_documento(obra_id, numero, null, 'prueba', true, 'PRECIOS') from caso;
       select 'PRECIOS', (select estado::text from ordenes_compra o join caso c using (obra_id) where o.numero = c.numero),
              (select count(*) from oc_items l join caso c on l.obra_id = c.obra_id and l.numero_oc = c.numero where l.comprobante_id is not null);
       rollback to savepoint s;
       select 'SIN MOTIVO', (select count(*) from caso);
       rollback;`,
    );
    const de = (k: string) => r.find((f) => f[0] === k) ?? [];
    // Datos o documentos: vuelve a «Guía o contrato» con su factura.
    expect(de("DATOS").slice(1)).toEqual(["FACTURADA", expect.not.stringMatching(/^0$/)]);
    // La factura: a «Facturar», con la factura anulada y las líneas libres.
    const [, estF, compF, anuladas] = de("FACTURA");
    expect([estF, compF]).toEqual(["PRECIOS_CONFIRMADOS", "0"]);
    expect(anuladas).toMatch(/^[1-9]\d* FACTURA$/);
    // Los precios: a cotización, también sin factura.
    expect(de("PRECIOS").slice(1)).toEqual(["EMITIDA", "0"]);
    // Sin motivo no hay rechazo.
    expect(() =>
      sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"' || ${uidSql("TESORERIA")} || '","role":"authenticated"}', true) is null;
        select rechazar_documento(obra_id, numero, null, '  ', false, 'DATOS') from ordenes_compra where estado = 'EN_TESORERIA' limit 1; rollback;`),
    ).toThrow(/motivo/);
  });
});

test.describe("@pagos @logistica etapas previas de la orden", () => {
  test("una orden recibida muestra su pago plegado", async ({ abrir }) => {
    const [obraId, numero] = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.estado = 'RECIBIDA' and o.tipo = 'OC'
          and exists (select 1 from pago_aplicaciones ap where ap.obra_id = o.obra_id and ap.numero_oc = o.numero)
        order by o.obra_id desc limit 1`,
    )[0];
    const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${encodeURIComponent(numero)}`);
    const pago = page.locator("details", { has: page.getByText("Pago", { exact: true }) });
    await expect(pago).toBeVisible();
    await expect(pago).not.toHaveAttribute("open", "");
    await pago.locator("summary").click();
    await expect(pago.getByText(/^Op\. /).first()).toBeVisible();
  });

  test("Logística y Tesorería ven todos los rechazos de la orden", async ({ abrir }) => {
    const fila = sql(
      `select obra_id, numero, count(*) from rechazos where obra_id is not null group by 1, 2 order by 3 desc, 1 limit 1`,
    )[0];
    test.skip(!fila, "sin rechazos en la base");
    const [obraId, numero, n] = fila;
    const page = await abrir("logistica", `/logistica/ordenes/${obraId}/${encodeURIComponent(numero)}`);
    const plegable = page.locator("details", { has: page.getByText(`Rechazos (${n})`) });
    await plegable.locator("summary").click();
    await expect(plegable.locator("li")).toHaveCount(Number(n));
  });
});

test.describe("@pagos @tesoreria @logistica contexto de la compra en el presupuesto", () => {
  test("la OC muestra el presupuesto de la obra, de sus etapas y de sus ítems", async ({ abrir, revisarPantalla }) => {
    const [obraId, numero] = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.estado = 'EN_TESORERIA' and o.tipo = 'OC' order by o.obra_id desc, o.numero limit 1`,
    )[0];
    const presupuesto = Number(sql1(`select coalesce(sum(parcial), 0) from v_avance_partida where obra_id = ${obraId}`));
    const etapas = sql(
      `select distinct p.etapa from oc_items l join partidas p on p.id = l.partida_id where l.obra_id = ${obraId} and l.numero_oc = '${numero}' order by 1`,
    ).map((f) => f[0]);
    const items = Number(sql1(`select count(distinct partida_id) from oc_items where obra_id = ${obraId} and numero_oc = '${numero}'`));

    // Tesorería: arranca plegado; al abrirlo se recuerda (la próxima vez abre así).
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    const contexto = page.locator("details", { has: page.locator("summary", { hasText: "Presupuesto" }) }).first();
    await expect(contexto).not.toHaveAttribute("open", "");
    await contexto.locator("summary").first().click();
    await expect(contexto).toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => document.cookie.includes("prod1_presupuesto_orden_tesoreria=1"))).toBe(true);
    await page.reload();
    await expect(contexto).toHaveAttribute("open", "");
    // Montos redondeados a soles en esta vista.
    const soles = (n: number) => Math.round(n).toLocaleString("es-PE", { maximumFractionDigits: 0 });
    await expect(contexto.locator(`li[aria-label^="Obra: presupuesto S/ ${soles(presupuesto)},"]`)).toBeVisible();
    for (const e of etapas) await expect(contexto.locator(`li[aria-label^="Etapa ${e}: "]`)).toBeVisible();
    // La flecha de «Ítems de la orden» sigue a su propio plegable, no al de Presupuesto que lo contiene.
    const flechaItems = contexto.locator("summary", { hasText: "Ítems de la orden" }).locator("svg");
    const girada = () => flechaItems.evaluate((e) => getComputedStyle(e).rotate === "180deg");
    expect(await girada(), "cerrado, la flecha apunta abajo").toBe(false);
    await contexto.locator("summary", { hasText: "Ítems de la orden" }).click();
    await expect(contexto.locator("summary", { hasText: `Ítems de la orden (${items})` })).toBeVisible();
    await expect.poll(girada, "abierto, la flecha apunta arriba").toBe(true);
    await revisarPantalla(page);

    // Logística: el mismo contexto, plegado.
    const log = await abrir("logistica", `/logistica/ordenes/${obraId}/${encodeURIComponent(numero)}`);
    const plegado = log.locator("details", { has: log.locator("summary", { hasText: "Presupuesto" }) }).first();
    await expect(plegado).not.toHaveAttribute("open", "");
    await plegado.locator("summary").first().click();
    await expect(plegado.locator(`li[aria-label^="Obra: presupuesto S/ ${soles(presupuesto)},"]`)).toBeVisible();
  });
});

test.describe("@pagos @tesoreria pago bloqueado", () => {
  test("si falta la guía de remisión, el formulario de pago está deshabilitado", async ({ abrir }) => {
    const fila = sql("select obra_id, numero from v_por_pagar where estado = 'PENDIENTE' and falta_guia order by obra_id desc, numero limit 1")[0];
    test.skip(!fila, "ninguna orden por pagar sin guía");
    const [obraId, numero] = fila;
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    await expect(page.getByRole("alert").filter({ hasText: "guía de remisión" })).toBeVisible();
    for (const campo of [
      page.getByRole("textbox", { name: "Monto", exact: true }),
      page.getByLabel("Fecha", { exact: true }),
      page.getByRole("textbox", { name: "N° de operación", exact: true }),
    ])
      await expect(campo).toBeDisabled();
    await expect(page.getByRole("button", { name: "Banco", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Subir voucher" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Aprobar pago" })).toBeDisabled();
  });
});

test.describe("@pagos @tesoreria avance de cada línea", () => {
  test("cada línea muestra lo ejecutado en cantidad y en soles frente al presupuesto de la partida", async ({ abrir }) => {
    const [obraId, numero, partida] = sql(
      `select l.obra_id, l.numero_oc, l.partida_id from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
        where o.estado = 'EN_TESORERIA' order by l.obra_id desc, l.numero_oc, l.id limit 1`,
    )[0];
    const [comprado, parcial] = sql(`select monto_comprado, parcial from v_avance_partida where partida_id = ${partida}`)[0];
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    await expect(page.getByText(`S/ ${dinero(Number(comprado))} / S/ ${dinero(Number(parcial))}`).first()).toBeVisible();
  });
});

test.describe("@pagos @tesoreria prod 1: sin pagos parciales", () => {
  // Una OC por pagar con detracción en su factura.
  const [obraId, numero, saldo, detraccion] = sql(`select v.obra_id, v.numero, v.saldo, sum(distinct c.detraccion) from v_por_pagar v
      join oc_items l on l.obra_id = v.obra_id and l.numero_oc = v.numero join comprobantes c on c.id = l.comprobante_id
      where v.estado = 'PENDIENTE' and v.doc = 'OC' and v.pagado = 0 and not v.falta_guia and c.detraccion > 0
      group by 1, 2, 3 order by 1 desc, 2 limit 1`)[0];
  const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  test("el monto viene fijo en el saldo y el total muestra la detracción y lo que se paga", async ({ abrir }) => {
    const page = await abrir("tesoreria", `/tesoreria/pago/${obraId}/${encodeURIComponent(numero)}`);
    const monto = page.getByRole("textbox", { name: "Monto" });
    await expect(monto).toHaveValue(`S/ ${fmt.format(Number(saldo))}`);
    await expect(monto).toHaveAttribute("readonly", "");
    const total = page.locator("main section", { hasText: "Total de la orden" }).first();
    await expect(total).toContainText(`Total de la ordenS/ ${fmt.format(Number(saldo) + Number(detraccion))}`);
    await expect(total).toContainText(`Detracción− S/ ${fmt.format(Number(detraccion))}`);
    await expect(total).toContainText(`A pagarS/ ${fmt.format(Number(saldo))}`);
  });

  test("la base rechaza un pago parcial", async () => {
    const uid = uidDe("TESORERIA");
    let error = "";
    try {
      sqlScript(`begin;
        select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
        set local role authenticated;
        select pagar_documento(${obraId}, '${numero}', null, current_date, 'BCP', 'PRUEBA-PARCIAL', ${Number(saldo) / 2}, 'pagos/prueba-parcial.png', 'prueba.png');
        rollback;`);
    } catch (e) {
      error = String((e as { stderr?: string }).stderr ?? e);
    }
    expect(error).toContain("no se aceptan pagos parciales");
  });
});
