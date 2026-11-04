import path from "node:path";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Flujos propios de prod 1 (sin Contabilidad ni valorizaciones): la guía la registra Logística y las OS
// de mano de obra se crean directo. Lo que se escribe se revierte al final de cada prueba.

test.describe("@prod1 @logistica guía de remisión", () => {
  test("Logística registra la guía (N°, archivo y traslado) y queda emitida; Tesorería ya no la pide", async ({ abrir }, info) => {
    // Una OC que requiere guía y la tiene sin registrar (la demo deja una con la solicitud a medias).
    const fila = sql(
      `select o.obra_id, o.numero, g.id from ordenes_compra o join guias g on g.obra_id = o.obra_id and g.numero_oc = o.numero
        where o.tipo = 'OC' and o.requiere_guia and o.estado not in ('BORRADOR','EMITIDA','ANULADA') and g.estado = 'SOLICITADA'
        order by o.estado = 'EN_TESORERIA' desc, o.obra_id desc limit 1`,
    )[0];
    test.skip(info.project.name !== "m390", "escribe en la base: corre en un solo proyecto");
    test.skip(!fila, "no hay OC con la guía sin registrar");
    const [obra, numero, guiaId] = fila;
    const estadoAntes = sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`);
    const numeroGuia = `T001-${Date.now() % 1000000}`;
    try {
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}`);
      const seccion = page.locator("section").filter({ has: page.getByText("Guía de remisión", { exact: true }) });
      await expect(seccion).toContainText("Sin registrar");
      await seccion.getByRole("button", { name: "Registrar guía" }).click();
      const hoja = page.getByRole("dialog", { name: "Registrar guía" });
      const enviar = hoja.getByRole("button", { name: "Registrar guía" });
      await expect(enviar, "sin N° ni archivo no se puede registrar").toBeDisabled();
      await hoja.getByLabel("N° de guía").fill(numeroGuia);
      await hoja.getByLabel("Guía (PDF o foto)").setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      await expect(hoja.getByText("ariant.png")).toBeVisible();
      await enviar.click();
      await expect(hoja).toBeHidden();
      await expect(seccion).toContainText(`Emitida ${numeroGuia}`);
      await expect(seccion.getByText("Ver guía")).toBeVisible();
      expect(sql1(`select estado || ' ' || numero_guia || ' ' || (archivo_path like 'guias/${obra}/${numero}/%') from guias where id = ${guiaId}`)).toBe(
        `EMITIDA ${numeroGuia} true`,
      );
      // Facturada, con la guía ya no le falta nada: va sola a Tesorería, que deja de ver «Falta la guía».
      if (estadoAntes === "FACTURADA") expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("EN_TESORERIA");
      if (sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`) === "EN_TESORERIA") {
        const pago = await abrir("tesoreria", `/tesoreria/pago/${obra}/${numero}`);
        await expect(pago.getByText(/Falta la guía de remisión/)).toHaveCount(0);
      }
    } finally {
      sql(`update guias set estado = 'SOLICITADA', numero_guia = null, archivo_path = null, emitido_by = null, emitido_at = null where id = ${guiaId};
           update ordenes_compra set estado = '${estadoAntes}' where obra_id = ${obra} and numero = '${numero}'`);
    }
  });

  test("Tesorería, sin la guía, ve que la registra Logística", async ({ abrir }) => {
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.estado = 'EN_TESORERIA' and o.requiere_guia
          and not exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero and g.estado = 'EMITIDA') limit 1`,
    )[0];
    test.skip(!fila, "no hay OC en Tesorería sin guía");
    const page = await abrir("tesoreria", `/tesoreria/pago/${fila[0]}/${fila[1]}`);
    await expect(page.getByText("Falta la guía de remisión: Logística debe registrarla antes del pago")).toBeVisible();
  });

  test("una OC facturada que requiere guía no se envía a Tesorería hasta que Logística la registra", async ({ abrir }) => {
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o where o.tipo = 'OC' and o.estado = 'FACTURADA' and o.requiere_guia
          and not exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero and g.estado in ('EMITIDA', 'ANULACION_PENDIENTE'))
          and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is null) limit 1`,
    )[0];
    expect(fila, "la demo PROD 1 trae una OC facturada que requiere guía sin registrar").toBeTruthy();
    const page = await abrir("logistica", `/logistica/ordenes/${fila[0]}/${fila[1]}?tipo=OC`);
    await expect(page.getByRole("button", { name: "Falta la guía de remisión" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar a Tesorería" })).toHaveCount(0);
    await page.getByRole("button", { name: "Falta la guía de remisión" }).click();
    await expect(page.locator("#guia")).toBeInViewport();
  });
});

test.describe("@prod1 @logistica OS de mano de obra", () => {
  test("Nueva OS ofrece las partidas de mano de obra y crear_orden las acepta sin valorización", async ({ abrir }) => {
    const [obra, partida, descripcion] = sql(
      `select p.obra_id, p.id, p.descripcion from v_partidas p join obras o on o.id = p.obra_id
        where p.rubro = 'MANO OBRA' and o.estado <> 'CERRADA' and o.presupuesto_estado = 'PUBLICADO' and p.saldo_cant > 1
        order by p.obra_id desc, p.id limit 1`,
    )[0];
    const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
    await page.getByPlaceholder("Buscar partida").fill(descripcion.slice(0, 20));
    await expect(page.locator("main").getByText(descripcion, { exact: true }).first()).toBeVisible();

    // La base acepta la OS de mano de obra (como Logística, en una transacción que se deshace).
    const uid = uidDe("LOGISTICA");
    const proveedor = sql1("select id from proveedores order by id limit 1");
    const r = sqlScript(`begin;
      select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
      set local role authenticated;
      select crear_orden(${obra}, '', ${proveedor}, 'OS', '[{"partida_id": ${partida}, "cantidad": 1}]'::jsonb) is not null;
      rollback;`);
    expect(r.flat()).toContain("t");
  });
});

test.describe("@prod1 @logistica Nueva OC: quién ya vendió el ítem", () => {
  test("sugiere primero a un proveedor que ya vendió el ítem, aunque el historial de la obra pase de 1000 líneas", async ({ abrir }) => {
    // La obra con más ventas de sus ítems de material, y de ella el ítem vendido más recientemente: con la
    // respuesta cortada en 1000 filas, esas ventas eran las que se perdían.
    const [obra] = sql(`select p.obra_id from v_partidas p join v_oc_items_calc c on c.item_id = p.item_id and c.estado <> 'ANULADA'
                        join obras o on o.id = p.obra_id where p.rubro = 'MATERIAL' and o.estado <> 'CERRADA' and o.presupuesto_estado = 'PUBLICADO'
                        group by 1 order by count(*) desc limit 1`)[0];
    expect(Number(sql1(`select count(*) from v_oc_items_calc c where c.estado <> 'ANULADA' and c.item_id in
                        (select item_id from v_partidas where obra_id = ${obra} and rubro = 'MATERIAL')`)), "el historial no pasa de 1000 líneas").toBeGreaterThan(1000);
    const [itemId, descripcion] = sql(`select p.item_id, p.descripcion from v_partidas p
        join (select item_id, max(id) mx from v_oc_items_calc where estado <> 'ANULADA' group by 1) v on v.item_id = p.item_id
        where p.obra_id = ${obra} and p.rubro = 'MATERIAL' and p.saldo_cant > 0 order by v.mx desc limit 1`)[0];
    const vendieron = sql(`select distinct pr.razon_social from v_oc_items_calc c join proveedores pr on pr.id = c.proveedor_id
                           where c.item_id = ${itemId} and c.estado <> 'ANULADA'`).map(([r]) => r);

    const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OC&obra=${obra}`);
    await page.getByPlaceholder("Buscar partida").fill(descripcion);
    await page.locator("main li", { hasText: descripcion }).first().getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Continuar/ }).click();
    await page.getByRole("button", { name: "Proveedor", exact: true }).click();
    const primera = page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").first();
    await expect(primera).toContainText("última orden");
    const texto = (await primera.textContent()) ?? "";
    expect(vendieron.some((v) => texto.startsWith(v)), `«${texto}» no está entre quienes vendieron ${descripcion}`).toBe(true);
  });

  test("acordeones: cada proveedor que vendió despliega lo que vendió (P.U. y fecha según SQL) y se elige desde ahí", async ({ abrir }) => {
    // Dos ítems de una obra con partidas de material: el primero lo vendió alguien que no vendió el segundo.
    const [obra, itemA, descA, , descB, provId, razon] = sql(`
      with v as (select distinct c.item_id, c.proveedor_id from v_oc_items_calc c where c.estado <> 'ANULADA')
      select a.obra_id, a.item_id, a.descripcion, b.item_id, b.descripcion, va.proveedor_id, pr.razon_social
        from v_partidas a join v_partidas b on b.obra_id = a.obra_id and b.item_id > a.item_id and b.rubro = 'MATERIAL' and b.saldo_cant > 0
        join obras o on o.id = a.obra_id and o.estado <> 'CERRADA' and o.presupuesto_estado = 'PUBLICADO'
        join v va on va.item_id = a.item_id
        join proveedores pr on pr.id = va.proveedor_id
       where a.rubro = 'MATERIAL' and a.saldo_cant > 0
         and not exists (select 1 from v where v.item_id = b.item_id and v.proveedor_id = va.proveedor_id)
       order by a.obra_id desc, a.item_id, b.item_id limit 1`)[0];
    // La fecha de su última orden y el P.U. de la última con precio.
    const base = `from v_oc_items_calc where item_id = ${itemA} and proveedor_id = ${provId} and estado <> 'ANULADA'`;
    const fecha = sql1(`select to_char(max(fecha), 'DD/MM/YY') ${base}`);
    const pu = sql1(`select pu_efectivo ${base} and pu_efectivo is not null order by fecha desc, id desc limit 1`);
    const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OC&obra=${obra}`);
    for (const d of [descA, descB]) {
      await page.getByPlaceholder("Buscar partida").fill(d);
      await page.locator("main li", { hasText: d }).first().getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: /^Continuar/ }).click();
    await page.getByRole("button", { name: "Proveedor", exact: true }).click();
    const hoja = page.getByRole("dialog", { name: "Proveedor" });
    await hoja.getByLabel("Buscar Proveedor").fill(razon);
    await hoja.getByRole("button", { name: `Detalle de ${razon}`, exact: true }).first().click();
    const fila = hoja.locator("li").filter({ has: page.getByRole("button", { name: `Detalle de ${razon}`, exact: true }) }).first();
    const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    await expect(fila.locator("li").filter({ hasText: descA })).toContainText(fecha);
    await expect(fila.locator("li").filter({ hasText: descA })).toContainText(pu ? `S/ ${fmt.format(Number(pu))}` : "Sin precio");
    await expect(fila.locator("li").filter({ hasText: descB })).toContainText("No lo vendió");
    await fila.getByRole("button", { name: `Elegir ${razon}` }).click();
    await expect(hoja).toBeHidden();
    await expect(page.getByRole("button", { name: "Proveedor", exact: true })).toHaveText(razon);
  });
});

test.describe("@prod1 @logistica Nueva OC: sin ordenar ni «Regular o adicional»", () => {
  test("no hay desplegables de orden ni de regular / adicional, y los adicionales llevan su marca", async ({ abrir }) => {
    const [obra, descripcion, req] = sql(`select obra_id, descripcion, requerimiento from v_partidas
        where rubro = 'MATERIAL' and requerimiento <> 'REGULAR' and saldo_cant > 0 order by obra_id, id limit 1`)[0];
    const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OC&obra=${obra}`);
    await expect(page.getByRole("button", { name: "Ordenar por", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Regular o adicional", exact: true })).toHaveCount(0);
    await page.getByPlaceholder("Buscar partida").fill(descripcion);
    const marca = req.replace(/^ADIC /, "Adicional ");
    const conMarca = page.locator("main li").filter({ has: page.getByText(marca, { exact: true }) }).first();
    await expect(conMarca).toBeVisible();
    await expect(conMarca).toContainText(descripcion.slice(0, 10));
    // Las regulares no llevan marca.
    await expect(page.locator("main li").filter({ hasText: "REGULAR" })).toHaveCount(0);
  });
});

test.describe("@prod1 @logistica diseños de la lista de órdenes", () => {
  const DISENOS = ["Lista", "Compacta", "Tarjetas", "Tabla", "Mosaico", "Por obra", "Por proveedor", "Por fecha", "Por etapa", "Por monto"];
  const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soles = (n: number | string) => `S/ ${fmt.format(Number(n))}`;

  test("el botón junto a la campana cambia el diseño (la lista actual es «Lista») y no pierde órdenes", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica?tipo=OC&tab=todas");
    const boton = page.getByRole("button", { name: /^Diseño/ });
    await expect(boton).toHaveAccessibleName("Diseño: Lista");
    const enlaces = page.locator("main a[href^='/logistica/ordenes/']");
    const n = await enlaces.count();
    expect(n).toBeGreaterThan(0);
    await boton.click();
    await expect(page.getByRole("dialog", { name: "Diseño" }).getByRole("radio")).toHaveText(DISENOS);
    await page.getByRole("dialog", { name: "Diseño" }).getByRole("button", { name: "Cerrar" }).click();
    for (const d of [...DISENOS.slice(1), "Lista"]) {
      await boton.click();
      await page.getByRole("dialog", { name: "Diseño" }).getByRole("radio", { name: d }).click();
      await expect(boton).toHaveAccessibleName(`Diseño: ${d}`);
      // En «Por etapa» una orden que toca varias etapas sale en cada una: se cuentan órdenes distintas.
      if (d === "Por etapa") expect(new Set(await enlaces.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).size, d).toBe(n);
      else await expect(enlaces, d).toHaveCount(n);
      if (d.startsWith("Por ")) await expect(page.locator("main h3").first()).toBeVisible();
      else await expect(page.locator("main h3")).toHaveCount(0);
    }
  });

  for (const [valor, nombre, col] of [["obra", "Por obra", "obra"], ["proveedor", "Por proveedor", "proveedor"]] as const) {
    test(`${nombre}: cada grupo con la cantidad y la suma de sus órdenes según SQL`, async ({ abrir }) => {
      const page = await abrir("logistica", "/logistica?tipo=OC&tab=teso");
      await page.context().addCookies([{ name: "prod1_diseno_logistica", value: valor, url: new URL(page.url()).origin }]);
      await page.reload();
      const grupos = page.locator("main h3");
      await expect(grupos.first()).toBeVisible();
      const esperado = new Map(
        sql(`select ${col}, count(*), coalesce(sum(total), 0) from v_ordenes where tipo = 'OC' and estado = 'EN_TESORERIA' group by 1`).map(
          ([k, c, s]) => [k, `${k} ${c}|${soles(s)}`],
        ),
      );
      for (const g of await grupos.all()) {
        const [titulo, suma] = await g.locator(":scope > span").allTextContents();
        const clave = titulo.replace(/\s\d+$/, "");
        expect(`${titulo}|${suma}`, clave).toBe(esperado.get(clave));
      }
    });
  }

  test("Por etapa: cada etapa con sus órdenes distintas y lo que piden en ella, según SQL; sin «Por empresa»", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica?tipo=OC&tab=teso");
    await page.context().addCookies([{ name: "prod1_diseno_logistica", value: "etapa", url: new URL(page.url()).origin }]);
    await page.reload();
    await page.getByRole("button", { name: /^Diseño/ }).click();
    await expect(page.getByRole("dialog", { name: "Diseño" }).getByRole("radio", { name: "Por empresa" })).toHaveCount(0);
    await page.getByRole("dialog", { name: "Diseño" }).getByRole("button", { name: "Cerrar" }).click();
    const grupos = page.locator("main h3");
    await expect(grupos.first()).toBeVisible();
    const esperado = new Map(
      sql(`select l.etapa, count(distinct (l.obra_id, l.numero_oc)), coalesce(sum(l.parcial), 0) from v_oc_items l
           join v_ordenes o on o.obra_id = l.obra_id and o.numero = l.numero_oc where o.tipo = 'OC' and o.estado = 'EN_TESORERIA' group by 1`).map(
        ([e, c, s]) => [e, `${e} ${c}|${soles(s)}`],
      ),
    );
    expect(await grupos.count()).toBe(esperado.size);
    for (const g of await grupos.all()) {
      const [titulo, suma] = await g.locator(":scope > span").allTextContents();
      const clave = titulo.replace(/\s\d+$/, "");
      expect(`${titulo}|${suma}`, clave).toBe(esperado.get(clave));
    }
  });

  test("obra arriba (sin empresa) y Filtros por secciones: varias etapas y monto iguales a SQL", async ({ abrir }) => {
    const [obra, nombre] = sql(`select obra_id, obra from v_ordenes where tipo = 'OC' group by 1, 2 order by count(*) desc limit 1`)[0];
    const page = await abrir("logistica", "/logistica?tipo=OC&tab=todas");
    await expect(page.getByRole("button", { name: /^Empresa/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Obra", exact: true }).click();
    await page.getByRole("listbox", { name: "Obra" }).getByRole("option").filter({ hasText: new RegExp(`^${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
    await expect(page).toHaveURL((u) => u.searchParams.get("obra") === obra);
    const [e1, e2] = sql(`select e from (select unnest(etapas) e, count(*) n from v_ordenes where tipo = 'OC' and obra_id = ${obra} group by 1) x order by n desc, e limit 2`).map(([e]) => e);
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    const hoja = page.getByRole("dialog", { name: "Filtros" });
    for (const s of ["Ordenar por", "Estado", "Fecha", "Monto", "Proveedor", "Etapas", "Tipos de material", "Sobreprecio"])
      await expect(hoja.getByRole("region", { name: s })).toBeVisible();
    await hoja.getByRole("checkbox", { name: e1, exact: true }).click();
    await hoja.getByRole("checkbox", { name: e2, exact: true }).click();
    await hoja.getByRole("radio", { name: "De 1,000 a 10,000" }).click();
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.getByRole("button", { name: "Filtros (3 activos)" })).toBeVisible();
    const n = Number(sql1(`select count(*) from v_ordenes where tipo = 'OC' and obra_id = ${obra} and etapas && array['${e1}', '${e2}'] and total >= 1000 and total < 10000`));
    await expect(page.locator("main a[href^='/logistica/ordenes/']")).toHaveCount(Math.min(n, 100));
  });

  for (const [rol, ruta, primero] of [
    ["logistica", "/logistica?tipo=OC&tab=todas", "searchbox"],
    ["tesoreria", "/tesoreria?empresa=todas&area=log&est=pag", "searchbox"],
  ] as const) {
    test(`${rol}: «Fijar filtros arriba» deja el buscador bajo la barra al desplazar, y se recuerda`, async ({ abrir }) => {
      const page = await abrir(rol, ruta);
      const buscador = page.getByRole(primero).first();
      // La barra superior de la pantalla (no el encabezado de una hoja).
      const barra = page.locator("body > div header, header.sticky").first();
      const filas = page.locator("main li a").first();
      const desplazar = async () => {
        await filas.waitFor();
        await expect.poll(async () => page.evaluate(() => (window.scrollTo(0, 1500), window.scrollY))).toBeGreaterThan(200);
      };
      await desplazar();
      await expect.poll(async () => (await buscador.boundingBox())?.y ?? -999).toBeLessThan(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: /^Diseño/ }).click();
      const fijar = page.getByRole("dialog", { name: "Diseño" }).getByRole("switch", { name: "Fijar filtros arriba" });
      await expect(fijar).toHaveAttribute("aria-checked", "false");
      await fijar.click();
      await expect(fijar).toHaveAttribute("aria-checked", "true");
      await page.getByRole("dialog", { name: "Diseño" }).getByRole("button", { name: "Cerrar" }).click();
      await page.reload();
      await desplazar();
      const alto = (await barra.boundingBox())!.height;
      await expect.poll(async () => Math.round((await buscador.boundingBox())?.y ?? -999)).toBeGreaterThanOrEqual(Math.floor(alto));
    });
  }
});

test.describe("@prod1 diseños de los ítems en el detalle de la orden", () => {
  const ITEMS = ["Lista", "Compacta", "Tabla", "Tarjetas", "Por etapa", "Con avance", "Precios", "Por importe", "Mosaico", "Resumen"];
  // Una OC ya en Tesorería (no se editan precios) con varios ítems.
  const [obra, numero] = sql(`select o.obra_id, o.numero from ordenes_compra o join oc_items l on l.obra_id = o.obra_id and l.numero_oc = o.numero
                              where o.tipo = 'OC' and o.estado = 'EN_TESORERIA' group by 1, 2 having count(*) >= 3 order by count(*) desc, 1, 2 limit 1`)[0];
  const descripciones = sql(`select distinct i.descripcion from oc_items l join partidas p on p.id = l.partida_id join items i on i.id = p.item_id
                             where l.obra_id = ${obra} and l.numero_oc = '${numero}'`).map(([d]) => d);

  for (const [rol, ruta] of [
    ["logistica", `/logistica/ordenes/${obra}/${encodeURIComponent(numero)}?tipo=OC`],
    ["tesoreria", `/tesoreria/pago/${obra}/${encodeURIComponent(numero)}`],
  ] as const) {
    test(`${rol}: botón arriba con 10 diseños de ítems, cada uno con todos los ítems, y se recuerda`, async ({ abrir }) => {
      const page = await abrir(rol, ruta);
      const boton = page.getByRole("button", { name: /^Diseño/ });
      await expect(boton).toHaveAccessibleName("Diseño: Lista");
      await boton.click();
      const hoja = page.getByRole("dialog", { name: "Diseño" });
      await expect(hoja.getByRole("radio")).toHaveText(ITEMS);
      const miniaturas = await hoja.getByRole("radio").evaluateAll((os) => os.map((o) => o.querySelector("[data-miniatura]")?.innerHTML ?? ""));
      expect(new Set(miniaturas).size, "miniaturas repetidas o vacías").toBe(ITEMS.length);
      await hoja.getByRole("button", { name: "Cerrar" }).click();
      for (const d of ITEMS.slice(1)) {
        await boton.click();
        await hoja.getByRole("radio", { name: d }).click();
        await expect(boton).toHaveAccessibleName(`Diseño: ${d}`);
        const items = page.locator('section[aria-label="Ítems de la orden"]');
        await expect(items).toHaveCount(1);
        for (const desc of descripciones) await expect(items, `${d}: ${desc}`).toContainText(desc);
      }
      await page.reload();
      await expect(page.getByRole("button", { name: "Diseño: Resumen" })).toBeVisible();
      await expect(page.locator('section[aria-label="Ítems de la orden"]')).toHaveAttribute("data-diseno", "resumen");
    });
  }
});

test.describe("@prod1 @logistica pestañas por estado y «Enviada»", () => {
  test("pestañas por estado (con «Enviada», sin «Recibidas»), y Cotizando al entrar", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica?tipo=OC");
    await expect(page.getByRole("tab")).toHaveText(["Cotizando", "Facturar", "Guía", "Tesorería", "Pagada", "Enviada", "Todas"]);
    // Todas a la vista, sin deslizar.
    for (const t of await page.getByRole("tab").all()) await expect(t).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("tab", { name: "Cotizando" })).toHaveAttribute("aria-selected", "true");
    // En OS la pestaña es «Contrato».
    const os = await abrir("logistica", "/logistica?tipo=OS");
    await expect(os.getByRole("tab")).toHaveText(["Cotizando", "Facturar", "Contrato", "Tesorería", "Pagada", "Enviada", "Todas"]);
    await expect(page.locator("main a[href^='/logistica/ordenes/']")).toHaveCount(
      Math.min(100, Number(sql1("select count(*) from ordenes_compra where tipo = 'OC' and estado = 'EMITIDA'"))),
    );
  });

  test("en «Guía» / «Contrato» cada fila dice lo que falta; las que no les falta nada ya se fueron solas a Tesorería", async ({ abrir }) => {
    const casos = sql(`select o.tipo, o.obra_id, o.numero,
        case when exists (select 1 from rechazos r where r.obra_id = o.obra_id and r.numero = o.numero and r.reenviado_at is null) then 'Rechazada'
             when o.tipo = 'OS' and not o.es_retencion and not exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero) then 'Firmar contrato'
             when o.tipo = 'OC' and o.requiere_guia and not exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero and g.estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then 'Subir guía'
             else 'Por enviar' end
        from ordenes_compra o join obras b on b.id = o.obra_id where o.estado = 'FACTURADA' and b.nombre like '%(PROD 1)' order by 1, 3`);
    // Lo que falta, o «Rechazada» (por datos: vuelve con su factura para corregir y reenviar); ninguna «Por enviar».
    expect(new Set(casos.map((c) => c[3])), "la demo PROD 1 trae esos casos y ninguna «Por enviar»").toEqual(new Set(["Firmar contrato", "Subir guía", "Rechazada"]));
    for (const [tipo, obra, numero, falta] of casos) {
      const page = await abrir("logistica", `/logistica?tipo=${tipo}&tab=fact&obra=${obra}`);
      await expect(page.locator(`main a[href^='/logistica/ordenes/${obra}/${numero}']`), `${tipo} ${numero}`).toContainText(falta);
    }
  });

  test("el total de la orden muestra la detracción entre lo facturado y lo pagado", async ({ abrir }) => {
    const [obra, numero, detraccion] = sql(`select o.obra_id, o.numero, sum(distinct c.detraccion) from ordenes_compra o
        join oc_items l on l.obra_id = o.obra_id and l.numero_oc = o.numero join comprobantes c on c.id = l.comprobante_id
        where o.tipo = 'OC' and c.detraccion > 0 group by 1, 2 order by 1 desc, 2 limit 1`)[0];
    const page = await abrir("logistica", `/logistica/ordenes/${obra}/${encodeURIComponent(numero)}?tipo=OC`);
    const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(page.locator("main section", { hasText: "Facturado" }).first()).toContainText(`Detracción− S/ ${fmt.format(Number(detraccion))}`);
  });

  test("una orden «Enviada» (constancia de pago enviada) avisa que los residentes aún no marcan las entregas", async ({ abrir }) => {
    const [obra, numero] = sql(`select obra_id, numero from ordenes_compra where tipo = 'OC' and estado = 'EN_ENTREGA' order by obra_id desc, numero limit 1`)[0];
    const page = await abrir("logistica", `/logistica/ordenes/${obra}/${encodeURIComponent(numero)}?tipo=OC`);
    await expect(page.getByText("Los residentes aún no pueden marcar las entregas.")).toBeVisible();
  });
});

/** Texto literal dentro de una expresión regular. */
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("@prod1 @gerencia adicionales", () => {
  test("Gerencia agrega un adicional de un ítem que ya está en la etapa; Logística lo ve marcado al crear la OC", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: corre en un solo proyecto");
    const [obra, itemId, etapa, descripcion, pu] = sql(`select p.obra_id, p.item_id, p.etapa, i.descripcion, p.pu from partidas p
        join items i on i.id = p.item_id join obras o on o.id = p.obra_id
        where o.nombre like '%(PROD 1)' and p.requerimiento = 'REGULAR' and i.rubro = 'MATERIAL' and p.etapa = 'L0' order by p.id limit 1`)[0];
    const n = Number(sql1(`select coalesce(max(substring(requerimiento from '^ADIC (\\d+)$')::int), 0) + 1 from partidas where obra_id = ${obra}`));
    try {
      const page = await abrir("gerencia", `/gerencia/obras/${obra}`);
      await page.getByRole("button", { name: "Nuevo adicional" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo adicional" });
      await hoja.getByRole("button", { name: "Ítem", exact: true }).click();
      // El selector muestra los primeros ítems: se busca.
      await page.getByRole("searchbox", { name: "Buscar Ítem" }).or(page.getByLabel("Buscar Ítem")).first().fill(descripcion);
      await page.getByRole("listbox", { name: "Ítem" }).getByRole("option").filter({ hasText: new RegExp(`^${escRe(descripcion)}`) }).first().click();
      await hoja.getByRole("button", { name: "Etapa", exact: true }).click();
      await page.getByRole("listbox", { name: "Etapa" }).getByRole("option", { name: etapa, exact: true }).click();
      await hoja.getByLabel("Cantidad partida 1").fill("7");
      // El P.U. se propone con el de la partida regular del mismo ítem y etapa.
      await expect(hoja.getByLabel("P.U. partida 1")).toHaveValue(String(Number(pu)));
      await hoja.getByRole("button", { name: /^Guardar adicional/ }).click();
      await expect(hoja).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Adicionales" })).toContainText(`Adicional ${n}`);
      expect(sql1(`select count(*) from partidas where obra_id = ${obra} and requerimiento = 'ADIC ${n}' and item_id = ${itemId} and etapa = '${etapa}' and cantidad = 7`)).toBe("1");
      expect(Number(sql1(`select count(*) from notificaciones n join perfiles p on p.user_id = n.user_id where p.rol = 'LOGISTICA' and n.titulo like 'Adicional ${n} en %'`))).toBeGreaterThan(0);

      // Logística: en Nueva OC, la partida regular y la adicional del mismo ítem, esta con su marca.
      const log = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OC&obra=${obra}`);
      await log.getByPlaceholder("Buscar partida").fill(descripcion);
      const filas = log.locator("main li", { hasText: descripcion });
      await expect(filas.filter({ hasText: `Adicional ${n}` })).toHaveCount(1);
      expect(await filas.count()).toBeGreaterThan(1);
    } finally {
      sql(`delete from notificaciones where titulo like 'Adicional ${n} en %'`);
      sql(`delete from partidas where obra_id = ${obra} and requerimiento = 'ADIC ${n}'`);
    }
  });
});

test.describe("@prod1 @gerencia lista de obras", () => {
  test("cada obra en su tarjeta con el nombre completo, sus partidas y el monto del presupuesto según SQL", async ({ abrir }) => {
    const page = await abrir("gerencia", "/gerencia/obras?tab=pub");
    const fmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const obras = sql(`select o.id, o.nombre, count(p.id), coalesce(sum(p.cantidad * coalesce(p.pu, 0)), 0) from obras o
                       left join partidas p on p.obra_id = o.id where o.presupuesto_estado = 'PUBLICADO'
                         and o.nombre not like 'E2E FLUJO %' group by 1, 2 order by 2`);
    // Sin la obra que crea flujo.spec en paralelo.
    await expect(page.locator("main li a[href^='/gerencia/obras/']").filter({ hasNotText: "E2E FLUJO" })).toHaveCount(obras.length);
    for (const [id, nombre, n, monto] of obras.slice(0, 6)) {
      const tarjeta = page.locator(`main a[href='/gerencia/obras/${id}']`);
      await expect(tarjeta, nombre).toContainText(nombre);
      await expect(tarjeta, nombre).toContainText(`${n} ${n === "1" ? "partida" : "partidas"}`);
      await expect(tarjeta, nombre).toContainText(`S/ ${fmt.format(Number(monto))}`);
    }
  });
});

test.describe("@prod1 consulta de la orden (solo lectura)", () => {
  // Una orden con la guía registrada (con archivo) y su factura, y una pagada (con voucher).
  const [gObra, gNum, gGuia, gComp] = sql(`select g.obra_id, g.numero_oc, coalesce(g.numero_guia, ''), c.serie || '-' || c.numero
                                           from guias g join oc_items l on l.obra_id = g.obra_id and l.numero_oc = g.numero_oc
                                           join comprobantes c on c.id = l.comprobante_id
                                           where g.archivo_path is not null and g.estado = 'EMITIDA' order by 1, 2 limit 1`)[0];
  const [pObra, pNum, pOp] = sql(`select o.obra_id, o.numero, p.numero_operacion from ordenes_compra o
                                  join oc_items l on l.obra_id = o.obra_id and l.numero_oc = o.numero
                                  join pago_aplicaciones a on a.comprobante_id = l.comprobante_id join pagos p on p.id = a.pago_id
                                  where o.estado = 'PAGADA' and p.numero_operacion is not null order by 1, 2 limit 1`)[0];

  for (const rol of ["gerencia"] as const) {
    test(`${rol}: datos, factura, guía, PDF de la orden y pagos, sin pagar ni rechazar`, async ({ abrir, revisarPantalla }) => {
      const page = await abrir(rol, `/consulta/orden/${gObra}/${encodeURIComponent(gNum)}`);
      const main = page.locator("main");
      await expect(main).toContainText("Proveedor");
      await expect(main).toContainText("Estado");
      await expect(main.getByRole("heading", { name: new RegExp(gComp) })).toBeVisible();
      await expect(main.getByText(`Guía de remisión ${gGuia}`.trim())).toBeVisible();
      await expect(main.getByRole("button", { name: /^O[CS] / })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Diseño/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Aprobar pago" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rechazar" })).toHaveCount(0);
      await expect(page.getByText("Subir voucher")).toHaveCount(0);
      await revisarPantalla(page);

      const pagada = await abrir(rol, `/consulta/orden/${pObra}/${encodeURIComponent(pNum)}`);
      await expect(pagada.locator("main")).toContainText(`Op. ${pOp}`);
      await expect(pagada.getByRole("button", { name: "Aprobar pago" })).toHaveCount(0);
    });
  }
});

test.describe("@prod1 diseños: sin datos redundantes", () => {
  const DISENOS = ["lista", "compacta", "tarjetas", "tabla", "mosaico", "etapa", "proveedor", "fecha", "monto"];
  // La obra con más OC en «Cotizando» (sin sobreprecio, para que la fila no tenga nada que avisar).
  const [obra, nombreObra] = sql(`select o.obra_id, b.nombre from ordenes_compra o join obras b on b.id = o.obra_id
                                   where o.tipo = 'OC' and o.estado = 'EMITIDA' group by 1, 2 order by count(*) desc limit 1`)[0];
  const filas = (page: import("@playwright/test").Page) => page.locator("main a[href^='/logistica/ordenes/']");

  test("en una pestaña de un estado, ninguna fila lo repite; con la obra elegida, tampoco la obra", async ({ abrir }) => {
    const page = await abrir("logistica", `/logistica?tipo=OC&tab=cot&obra=${obra}`);
    for (const d of DISENOS) {
      await page.context().addCookies([{ name: "prod1_diseno_logistica", value: d, url: new URL(page.url()).origin }]);
      await page.reload();
      await expect(filas(page).first(), d).toBeVisible();
      for (const t of await filas(page).allInnerTexts()) {
        if (/Sobreprecio/.test(t)) continue;
        expect(t, `${d}: repite el estado`).not.toContain("Cotizando");
        expect(t, `${d}: repite la obra`).not.toContain(nombreObra);
      }
    }
  });

  test("en «Todas» cada fila dice su estado", async ({ abrir }) => {
    const page = await abrir("logistica", `/logistica?tipo=OC&tab=todas&obra=${obra}`);
    await page.context().addCookies([{ name: "prod1_diseno_logistica", value: "lista", url: new URL(page.url()).origin }]);
    await page.reload();
    const estados = ["Rechazada", "Cotizando", "Facturar", "Por facturar", "Por enviar", "Tesorería", "En Tesorería", "Pagada", "Enviada", "Recibida", "Anulada", "Sobreprecio", "Subir guía", "Firmar contrato", "Precios confirmados"];
    for (const t of (await filas(page).allInnerTexts()).slice(0, 10)) expect(estados.some((e) => t.includes(e)), t).toBe(true);
  });

  test("Pagos con una obra elegida: las filas no repiten la obra", async ({ abrir }) => {
    const [empresa, obraTes, nombre] = sql(`select v.empresa_id, v.obra_id, v.obra from v_por_pagar v where v.estado = 'PENDIENTE'
                                             group by 1, 2, 3 order by count(*) desc limit 1`)[0];
    const page = await abrir("tesoreria", `/tesoreria?empresa=${empresa}&area=log&obra=${obraTes}`);
    for (const d of ["lista", "tarjetas", "proveedor"]) {
      await page.context().addCookies([{ name: "prod1_diseno_pagos", value: d, url: new URL(page.url()).origin }]);
      await page.reload();
      const f = page.locator("main a[href^='/tesoreria/pago/']");
      await expect(f.first(), d).toBeVisible();
      for (const t of await f.allInnerTexts()) expect(t, `${d}: repite la obra`).not.toContain(nombre);
    }
  });
});

test.describe("@prod1 @gerencia presupuesto de la obra: filtros y adicionales", () => {
  // La obra publicada con más partidas de un mismo adicional.
  const [obra, req, n] = sql(`select p.obra_id, p.requerimiento, count(*) from partidas p join obras o on o.id = p.obra_id
                               where o.presupuesto_estado = 'PUBLICADO' and p.requerimiento <> 'REGULAR'
                               group by 1, 2 order by 3 desc limit 1`)[0];
  const nombre = req.replace(/^ADIC/, "Adicional");
  const total = sql1(`select count(*) from partidas where obra_id = ${obra}`);

  test("filtrar por un adicional deja solo sus partidas, todas marcadas; el buscador filtra por ítem", async ({ abrir }) => {
    const page = await abrir("gerencia", `/gerencia/obras/${obra}`);
    const lista = page.locator("main ul").filter({ has: page.locator("li button") }).last();
    await expect(page.locator("main")).toContainText(`${total} partidas`);
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    const hoja = page.getByRole("dialog", { name: "Filtros" });
    for (const s of ["Requerimiento", "Etapas", "Rubro", "P.U."]) await expect(hoja.getByRole("region", { name: s })).toBeVisible();
    await hoja.getByRole("checkbox", { name: nombre, exact: true }).click();
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.getByRole("button", { name: "Filtros (1 activos)" })).toBeVisible();
    await expect(page.locator("main")).toContainText(`${n} de ${total} partidas`);
    const filas = lista.locator("li");
    await expect(filas).toHaveCount(Number(n));
    for (const t of await filas.allInnerTexts()) expect(t).toContain(nombre);
    // Buscador: por la descripción del ítem.
    const [desc] = sql(`select i.descripcion from partidas p join items i on i.id = p.item_id where p.obra_id = ${obra} and p.requerimiento = '${req}' order by p.id limit 1`)[0];
    await page.getByLabel("Buscar ítem").fill(desc);
    await expect(filas.first()).toContainText(desc);
    for (const t of await filas.allInnerTexts()) expect(t).toContain(desc);
  });
});
