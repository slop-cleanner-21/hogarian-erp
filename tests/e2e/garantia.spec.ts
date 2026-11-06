import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Retención por garantía de las OS, su devolución en una OS de retenciones y los borradores de Nueva OC / OS en la cuenta.

/** Una partida de mano de obra (regular) con saldo, de una obra abierta, y un proveedor. */
const partidaMo = () => {
  const [obra, partida, pu, descripcion] = sql(
    `select p.obra_id, p.id, p.pu, p.descripcion from v_partidas p join obras o on o.id = p.obra_id
      where p.rubro = 'MANO OBRA' and p.requerimiento = 'REGULAR' and p.pu > 1 and p.saldo_cant >= 2
        and o.presupuesto_estado = 'PUBLICADO' and o.estado <> 'CERRADA'
      order by p.obra_id desc, p.id limit 1`,
  )[0];
  return { obra, partida, pu: Number(pu), descripcion };
};
const proveedorId = () => sql1("select id from proveedores where comprobante_habitual = 'RXH' order by id limit 1");

test.describe("@logistica retención por garantía en la base", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("se descuenta en la línea, va al comprobante neto y se devuelve en la OS de retenciones con la obra cerrada", () => {
    const { obra, partida, pu } = partidaMo();
    const prov = proveedorId();
    const log = uidDe("LOGISTICA");
    const jefe = uidDe("JEFE_OPERACIONES");
    const filas = sqlScript(`begin;
      create function pg_temp.t(p_uid text, p_sql text) returns text language plpgsql as $f$
      declare r text;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        set local role authenticated;
        execute p_sql into r;
        reset role;
        return coalesce(r, '');
      exception when others then
        return 'error: ' || sqlerrm;
      end $f$;
      create function pg_temp.escenario() returns setof text language plpgsql as $e$
      declare v_n text; v_d text; v_t text;
      begin
        return next 'pct100|' || pg_temp.t('${log}', $q$select crear_orden(${obra}, null, ${prov}, 'OS', '[{"partida_id":${partida},"cantidad":1,"ret_garantia_pct":100}]')$q$);
        return next 'oc|' || pg_temp.t('${log}', $q$select crear_orden(${obra}, null, ${prov}, 'OC', '[{"partida_id":${partida},"cantidad":1,"ret_garantia_pct":5}]')$q$);
        v_n := pg_temp.t('${log}', $q$select crear_orden(${obra}, null, ${prov}, 'OS', '[{"partida_id":${partida},"cantidad":2,"ret_garantia_pct":5}]')$q$);
        return next 'linea|' || (select l.pu_cotizado || '|' || l.parcial || '|' || l.retenido || '|' || l.sobreprecio from v_oc_items_calc l where l.obra_id = ${obra} and l.numero_oc = v_n);
        return next 'total|' || (select total from v_ordenes where obra_id = ${obra} and numero = v_n);
        return next 'cambiar|' || pg_temp.t('${log}', format($q$update oc_items set ret_garantia_pct = 0 where obra_id = ${obra} and numero_oc = %L returning id$q$, v_n));
        return next 'retenidas_jefe|' || pg_temp.t('${jefe}', format($q$select count(*) from v_os_retenidas where obra_id = ${obra} and numero = %L$q$, v_n));
        return next 'retenidas_log|' || pg_temp.t('${log}', format($q$select retenido from v_os_retenidas where obra_id = ${obra} and numero = %L$q$, v_n));

        update ordenes_compra set estado = 'PAGADA' where obra_id = ${obra} and numero = v_n;
        return next 'abierta|' || pg_temp.t('${log}', $q$select crear_orden_retencion(${obra}, null, ${prov})$q$);
        update obras set estado = 'CERRADA' where id = ${obra};
        return next 'jefe|' || pg_temp.t('${jefe}', $q$select crear_orden_retencion(${obra}, null, ${prov})$q$);
        v_d := pg_temp.t('${log}', $q$select crear_orden_retencion(${obra}, null, ${prov})$q$);
        return next 'devolucion|' || (select o.estado || '|' || o.es_retencion || '|' || o.comprobante_tipo || '|' || o.glosa_rhe from ordenes_compra o where o.obra_id = ${obra} and o.numero = v_d);
        return next 'devuelve|' || (select total from v_ordenes where obra_id = ${obra} and numero = v_d);
        return next 'marcada|' || ((select retenida_en from ordenes_compra where obra_id = ${obra} and numero = v_n) = v_d);
        return next 'otra|' || pg_temp.t('${log}', $q$select crear_orden_retencion(${obra}, null, ${prov})$q$);

        update ordenes_compra set estado = 'FACTURADA' where obra_id = ${obra} and numero = v_d;
        return next 'sin_contrato|' || pg_temp.t('${log}', format($q$select enviar_a_tesoreria(${obra}, %L)$q$, v_d));
        return next 'no_sola|' || pg_temp.t('${log}', format($q$select enviar_si_lista(${obra}, %L)$q$, v_d));

        update ordenes_compra set estado = 'ANULADA', motivo_anulacion = 'e2e' where obra_id = ${obra} and numero = v_d;
        return next 'anulada|' || ((select retenida_en from ordenes_compra where obra_id = ${obra} and numero = v_n) is null);
        return next 'de_nuevo|' || (pg_temp.t('${log}', $q$select crear_orden_retencion(${obra}, null, ${prov})$q$) not like 'error%');
      end $e$;
      select * from pg_temp.escenario();
      rollback;`);
    const r = Object.fromEntries(filas.map(([k, ...v]) => [k, v.join("|")]));
    const bruto = Math.round(2 * pu * 100) / 100;
    const neto = Math.round(2 * pu * 0.95 * 100) / 100;
    const retenido = (bruto - neto).toFixed(2);

    expect(r.pct100).toBe("error: La retención por garantía va de 0 a 99.99 %");
    expect(r.oc).toBe("error: La retención por garantía es solo de las OS");
    expect(r.linea.split("|").slice(1), "el P.U. no cambia, el parcial es el neto").toEqual([neto.toFixed(2), retenido, "false"]);
    expect(Number(r.linea.split("|")[0])).toBe(pu);
    expect(Number(r.total), "el total de la orden es lo que se factura").toBe(neto);
    expect(r.cambiar, "solo al crearla").not.toMatch(/^\d+$/);
    expect(r.retenidas_jefe, "el Jefe no lee lo financiero").toBe("0");
    expect(r.retenidas_log).toBe(retenido);
    expect(r.abierta).toBe("error: Las retenciones se devuelven con la obra cerrada");
    expect(r.jefe).toMatch(/^error/);
    expect(r.devolucion).toMatch(/^PRECIOS_CONFIRMADOS\|true\|RXH\|Retenciones de la obra /);
    expect(r.devuelve, "devuelve lo retenido, al céntimo").toBe(retenido);
    expect(r.marcada).toBe("true");
    expect(r.otra, "no se devuelve dos veces").toBe("error: Este proveedor no tiene retención por devolver en la obra");
    expect(r.sin_contrato).toMatch(/^error: Falta el contrato firmado de la OS/);
    expect(r.no_sola).toBe("false");
    expect(r.anulada, "al anularla, vuelve a estar por devolver").toBe("true");
    expect(r.de_nuevo).toBe("true");
  });
});

test.describe("@logistica garantía de las OS históricas", () => {
  test("sus montos no se mueven y lo ya devuelto no se vuelve a pagar", ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
    // El neto sigue siendo el del Excel: cantidad × P.U. neto, y lo retenido es lo que falta para el 100 %.
    expect(
      sql1(`select count(*) from v_oc_items_calc where pu_bruto is not null
             and (parcial <> round(cantidad * pu_efectivo, 2) or retenido <> round(cantidad * pu_bruto, 2) - parcial or retenido < 0)`),
    ).toBe("0");
    expect(
      sql1(`select count(*) from comprobantes c where c.historico and c.anulado_at is null
             and exists (select 1 from oc_items l where l.comprobante_id = c.id and l.pu_bruto is not null)
             and abs(c.total - (select sum(v.parcial) from v_oc_items_calc v where v.comprobante_id = c.id)) > 0.05`),
      "cada comprobante sigue cuadrando con sus líneas",
    ).toBe("0");
    expect(Number(sql1("select count(*) from oc_items where pu_bruto is not null"))).toBeGreaterThan(0);
    // Donde la devolución ya se pagó, nada queda por devolver.
    expect(
      sql1(`select coalesce(sum(r.retenido), 0) from v_os_retenidas r
             where r.retenida_en is null and r.obra_id in (
               select c.obra_id from v_oc_items_calc c where c.descripcion ilike 'RETENCION%' and c.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA'))`),
    ).toBe("0");
    expect(sql1("select count(*) from oc_items l join partidas p on p.id = l.partida_id join items i on i.id = p.item_id where i.descripcion ilike 'RETENCION%' and l.pu_bruto is not null"), "la devolución no es retención").toBe("0");
  });
});

test.describe("@logistica pantallas de garantía y borradores", () => {
  test("Nueva OS: retención por defecto, borrador en la cuenta, otra orden aparte, retomar y emitir", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const { obra, descripcion } = partidaMo();
    const texto = descripcion.slice(0, 20);
    const uid = uidDe("LOGISTICA");
    sql(`delete from orden_borradores where user_id = '${uid}'`);
    let numero = "";
    try {
      const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("prod1_borrador")).forEach((k) => localStorage.removeItem(k)));
      await page.reload();
      await page.getByPlaceholder("Buscar partida").fill(texto);
      await page.locator("main label").filter({ hasText: texto }).first().locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: /^Continuar/ }).click();

      const seccion = page.getByRole("region", { name: "Retención por garantía" });
      await expect(seccion.getByLabel("Retención Mano de obra")).toHaveValue("5");
      await seccion.getByLabel("Retención Mano de obra").fill("7");
      await page.getByRole("button", { name: "Proveedor", exact: true }).click();
      const opcion = page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").first();
      const proveedor = (await opcion.locator("span span").first().innerText()).trim();
      await opcion.click();
      await page.getByRole("button", { name: "Guardar borrador" }).click();

      await expect(page).toHaveURL(/tab=bor/);
      const lista = page.getByRole("list", { name: "Borradores" });
      await expect(lista).toContainText(proveedor);
      expect(sql1(`select count(*) from orden_borradores where user_id = '${uid}' and tipo = 'OS'`)).toBe("1");

      // Se puede empezar otra: Nueva arranca sin lo guardado.
      await page.goto(`/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
      await expect(page.getByPlaceholder("Buscar partida")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Continuar/ })).toBeDisabled();

      await page.goto("/logistica?tipo=OS&tab=bor");
      await page.getByRole("list", { name: "Borradores" }).getByRole("link").first().click();
      await expect(page).toHaveURL(/borrador=/);
      await expect(page.getByRole("button", { name: "Proveedor", exact: true })).toContainText(proveedor);
      await expect(page.getByLabel("Retención Mano de obra")).toHaveValue("7");

      await page.getByRole("button", { name: "Comprobante", exact: true }).click();
      await page.getByRole("listbox", { name: "Comprobante" }).getByRole("option", { name: "Recibo por honorarios" }).click();
      await page.getByLabel("Fecha de inicio").fill("2026-01-15");
      await page.getByRole("button", { name: "Confirmar" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Sí|Emitir/ }).click();
      await expect(page).toHaveURL(/\/logistica\/ordenes\/\d+\/[^/?]+\?tipo=OS/);
      numero = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
      expect(sql1(`select ret_garantia_pct from oc_items where obra_id = ${obra} and numero_oc = '${numero}' limit 1`)).toBe("7.00");
      expect(sql1(`select count(*) from orden_borradores where user_id = '${uid}'`), "se borra al emitir").toBe("0");
      await expect(page.locator("main")).toContainText("Retención por garantía");
    } finally {
      sql(`delete from orden_borradores where user_id = '${uid}'`);
      if (numero) sql(`delete from oc_items where obra_id = ${obra} and numero_oc = '${numero}'; delete from ordenes_compra where obra_id = ${obra} and numero = '${numero}';`);
    }
  });

  test("las diez pestañas de OC / OS caben en dos filas", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica?tipo=OS&tab=bor");
    await expect(page.getByRole("tab", { name: "Borrador" })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("Retenciones: lo acumulado por proveedor y obra; cerrada la obra se crea la OS con su contrato; aviso de suspensión", async ({ abrir, request }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [empresa] = sql("select id from empresas order by id limit 1")[0];
    const [item] = sql("select id from items where rubro = 'MANO OBRA' order by id limit 1")[0];
    const [prov, razon] = sql("select id, razon_social from proveedores where comprobante_habitual = 'RXH' order by id desc limit 1")[0];
    const [pct, fechaS, pathS, opS] = sql(
      `select retencion_4ta_pct, coalesce(suspension_4ta_fecha::text, ''), coalesce(suspension_4ta_path, ''), coalesce(suspension_4ta_operacion, '') from proveedores where id = ${prov}`,
    )[0];
    sql(`update proveedores set suspension_4ta_fecha = null, suspension_4ta_path = null, suspension_4ta_operacion = null where id = ${prov}`);
    const nombre = `E2E GARANTIA ${Date.now()}`;
    // Con id negativo: las pruebas que corren a la vez buscan órdenes desde la obra más nueva, y no deben tomar estas.
    const obra = sql1(`insert into obras (id, empresa_id, nombre, presupuesto_estado) values (-${Date.now() % 1000000}, ${empresa}, '${nombre}', 'PUBLICADO') returning id`);
    try {
      const partida = sql1(
        `insert into partidas (obra_id, codigo, etapa, requerimiento, item_id, cantidad, pu)
         select ${obra}, 'E2E-1', (select codigo from etapas order by orden limit 1), 'REGULAR', ${item}, 100, 100 returning id`,
      );
      sql(`insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, estado, comprobante_tipo, fecha_inicio) values
             (${obra}, 'E2E-P', 'OS', ${prov}, 'EMITIDA', 'RXH', current_date), (${obra}, 'E2E-S', 'OS', ${prov}, 'EMITIDA', 'RXH', current_date);
           insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado, ret_garantia_pct) values
             (${obra}, 'E2E-P', ${partida}, 20, 100, 5), (${obra}, 'E2E-S', ${partida}, 30, 100, 5);
           update ordenes_compra set estado = 'PRECIOS_CONFIRMADOS' where obra_id = ${obra} and numero = 'E2E-S';
           update ordenes_compra set estado = 'PRECIOS_CONFIRMADOS' where obra_id = ${obra} and numero = 'E2E-P';
           update ordenes_compra set estado = 'PAGADA' where obra_id = ${obra} and numero = 'E2E-P';`);

      // Recibo de más de S/ 1,500 sin suspensión: el aviso. Con la suspensión del año, ya no.
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/E2E-S?tipo=OS`);
      const aviso = page.getByText("Sin suspensión de 4ta: pídele la constancia al proveedor");
      await expect(aviso).toBeVisible();
      sql(`update proveedores set suspension_4ta_fecha = current_date, suspension_4ta_operacion = '12345678' where id = ${prov}`);
      await page.reload();
      await expect(page.getByText("Retención por garantía").first()).toBeVisible();
      await expect(aviso).toHaveCount(0);

      await page.goto(`/logistica/retenciones?obra=${obra}`);
      const fila = page.getByRole("list", { name: "Retenciones por proveedor" }).getByRole("listitem").filter({ hasText: razon }).first();
      await expect(fila).toContainText("S/ 100.00");
      await expect(page.locator("main dl")).toContainText("S/ 150.00");
      await fila.locator("summary").click();
      await expect(fila.getByRole("button", { name: "Obra sin cerrar" })).toBeDisabled();

      sql(`update obras set estado = 'CERRADA' where id = ${obra}`);
      await page.reload();
      await fila.locator("summary").click();
      await fila.getByRole("button", { name: "Crear OS de retenciones" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Sí/ }).click();
      await expect(page).toHaveURL(new RegExp(`/logistica/ordenes/${obra}/`));
      const numero = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
      await expect(page.locator("main")).toContainText("Contrato de locación");
      await expect(page.locator("main")).toContainText(`Retenciones de la obra ${nombre}`);
      expect(sql1(`select retenida_en from ordenes_compra where obra_id = ${obra} and numero = 'E2E-P'`)).toBe(numero);
      expect(sql1(`select total from v_ordenes where obra_id = ${obra} and numero = '${numero}'`)).toBe("100.00");

      // El contrato del link del proveedor se genera (lleva las OS retenidas).
      const token = sql1(`select token_cotizacion from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`);
      const r = await request.get(`/cotizar/${token}/archivo?tipo=contrato`);
      expect(r.status()).toBe(200);
      expect(r.headers()["content-type"]).toContain("application/pdf");
    } finally {
      sql(`delete from cotizacion_accesos where obra_id = ${obra}; delete from notificaciones where href like '%/${obra}/%';
           delete from oc_items where obra_id = ${obra}; delete from ordenes_compra where obra_id = ${obra}; delete from partidas where obra_id = ${obra};
           delete from obra_etapas where obra_id = ${obra}; delete from obras where id = ${obra};
           update proveedores set retencion_4ta_pct = ${pct}, suspension_4ta_fecha = ${fechaS ? `'${fechaS}'` : "null"}, suspension_4ta_path = ${pathS ? `'${pathS}'` : "null"},
             suspension_4ta_operacion = ${opS ? `'${opS}'` : "null"} where id = ${prov};`);
    }
  });
});
