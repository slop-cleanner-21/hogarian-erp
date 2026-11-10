import { unzipSync, strFromU8 } from "fflate";
import { archivosPlame, quintoDiaHabil, txtDetracciones } from "../../src/lib/sunat";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Contabilidad (2): libro diario y mayor, asientos manuales, contabilizar en lote, cierre de periodo, archivos para SUNAT
// (pago masivo de detracciones y PLAME), vencimientos y avisos. Lo de la base corre en transacciones revertidas.

/** Sentencias como Contabilidad en una transacción revertida: «ok: …» o «error: …» por cada una; `despues` como postgres. */
function comoContabilidad(sentencias: string[], antes = "select 1", despues = "select 'fin'") {
  const uid = uidDe("CONTABILIDAD");
  const cuerpo = sentencias
    .map(
      (s, i) => `
    set local role authenticated;
    do $$ declare v text; begin
      execute $q$${s}$q$ into v;
      perform set_config('e2e.r${i}', 'ok: ' || coalesce(v, ''), true);
    exception when others then
      perform set_config('e2e.r${i}', 'error: ' || sqlerrm, true);
    end $$;
    reset role;`,
    )
    .join("\n");
  const out = sqlScript(`begin;
    select set_config('app.skip_audit', 'on', true) is null;
    ${antes};
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
    ${cuerpo}
    select ${sentencias.map((_, i) => `current_setting('e2e.r${i}')`).join(", ")};
    ${despues};
    rollback;`);
  return { r: out.at(-2)!, despues: out.at(-1)! };
}

const empresa = () => sql1("select id from empresas order by id limit 1");
const mesPasado = () => sql1("select to_char((now() at time zone 'America/Lima')::date - interval '1 month', 'YYYYMM')");

test.describe("@contabilidad asientos manuales, lote y cierre: la base", () => {
  test("asiento manual: cuadrado, con cuentas del plan y una cuenta por línea; solo el manual se anula", () => {
    const e = empresa();
    const [d, h] = sql("select codigo from cuentas_contables order by codigo limit 2").map(([c]) => c);
    const asiento = (lineas: object[], glosa = "E2E manual") =>
      `select registrar_asiento_manual(${e}, current_date, '${glosa}', '${JSON.stringify(lineas)}'::jsonb)::text`;
    const compra = sql1("select id from asientos where origen = 'COMPRA' limit 1");
    const { r, despues } = comoContabilidad(
      [
        asiento([{ cuenta: d, debe: 100 }, { cuenta: h, haber: 90 }]),
        asiento([{ cuenta: d, debe: 100 }, { cuenta: "000000", haber: 100 }]),
        asiento([{ cuenta: d, debe: 100 }]),
        asiento([{ cuenta: d, debe: 100, haber: 100 }, { cuenta: h, haber: 0 }]),
        asiento([{ cuenta: d, debe: 100 }, { cuenta: h, haber: 100 }], ""),
        asiento([{ cuenta: d, debe: 100.5 }, { cuenta: h, haber: 100.5 }]),
        ...(compra ? [`select anular_asiento_manual(${compra})::text`] : []),
        `select anular_asiento_manual((select id from asientos where origen = 'MANUAL' and glosa = 'E2E manual'))::text`,
      ],
      "select 1",
      "select count(*) from asientos where glosa = 'E2E manual'",
    );
    let i = 0;
    expect(r[i++]).toMatch(/^error: El asiento no cuadra: Debe S\/ 100.00 y Haber S\/ 90.00/);
    expect(r[i++]).toBe("error: La cuenta 000000 no está en el plan");
    expect(r[i++]).toBe("error: El asiento lleva al menos dos líneas");
    expect(r[i++]).toMatch(/^error: Cada línea lleva un monto en el Debe o en el Haber/);
    expect(r[i++]).toBe("error: Ingresa la glosa");
    expect(r[i++]).toMatch(/^ok: \d+$/);
    if (compra) expect(r[i++]).toBe("error: Solo se anula un asiento manual");
    expect(r[i++]).toBe("ok: ");
    expect(despues, "anulado: ya no está").toEqual(["0"]);
  });

  test("contabilizar en lote: los que se pueden, y de los demás por qué no", () => {
    const listo = sql1(`select comprobante_id from v_registro_compras where asiento_id is null and coalesce(items_sin_cuenta, 0) = 0 limit 1`);
    const sinCuenta = sql1(`select comprobante_id from v_registro_compras where asiento_id is null and items_sin_cuenta > 0 limit 1`);
    test.skip(!listo || !sinCuenta, "faltan comprobantes de los dos casos");
    const { r, despues } = comoContabilidad(
      [`select contabilizar_comprobantes(array[${listo}, ${sinCuenta}]::bigint[])::text`],
      "select 1",
      `select count(*) from asientos where comprobante_id in (${listo}, ${sinCuenta})`,
    );
    const res = JSON.parse(r[0].replace(/^ok: /, ""));
    expect(res.contabilizados).toBe(1);
    expect(res.errores).toHaveLength(1);
    expect(res.errores[0].id).toBe(Number(sinCuenta));
    expect(res.errores[0].error).toMatch(/Hay ítems sin cuenta contable/);
    expect(despues).toEqual(["1"]);
  });

  test("cierre de periodo: solo un mes terminado; cerrado, no se corrigen sus comprobantes ni se hacen asientos, y uno nuevo va al siguiente", () => {
    const e = empresa();
    const mes = mesPasado();
    const comp = sql1(`select id from comprobantes where empresa_id = ${e} and periodo_anotacion = '${mes}' and anulado_at is null limit 1`);
    const [d, h] = sql("select codigo from cuentas_contables order by codigo limit 2").map(([c]) => c);
    const fechaMes = `to_date('${mes}01', 'YYYYMMDD')`;
    const prov = sql1("select id from proveedores order by id limit 1");
    const { r, despues } = comoContabilidad(
      [
        `select cerrar_periodo(${e}, to_char((now() at time zone 'America/Lima')::date, 'YYYYMM'))::text`,
        `select cerrar_periodo(${e}, '${mes}')::text`,
        `select registrar_asiento_manual(${e}, ${fechaMes}, 'E2E cerrado', '[{"cuenta":"${d}","debe":10},{"cuenta":"${h}","haber":10}]'::jsonb)::text`,
      ],
      "select 1",
      `do $$ begin
         ${comp ? `update comprobantes set total = total where id = ${comp}; update comprobantes set igv = igv + 1 where id = ${comp};` : ""}
         perform set_config('e2e.c', 'cambió', true);
       exception when others then perform set_config('e2e.c', sqlerrm, true); end $$;
       insert into comprobantes (empresa_id, proveedor_id, tipo, serie, numero, fecha_emision, total, base, igv, retencion)
       values (${e}, ${prov}, 'FACTURA', 'E2EC', '1', ${fechaMes}, 118, 100, 18, 0);
       select coalesce(current_setting('e2e.c', true), '') || '|' || (select periodo_anotacion from comprobantes where serie = 'E2EC' and numero = '1')
              || '|' || to_char(${fechaMes} + interval '1 month', 'YYYYMM')`,
    );
    expect(r[0]).toBe("error: Solo se cierra un mes que ya terminó");
    expect(r[1]).toBe("ok: ");
    expect(r[2]).toMatch(/^error: El periodo \d\d\/\d{4} está cerrado/);
    const [cambio, anotado, siguiente] = despues;
    if (comp) expect(cambio, "no se corrige").toMatch(/está cerrado: Contabilidad debe reabrirlo/);
    expect(anotado, "uno nuevo se anota en el mes siguiente abierto").toBe(siguiente);
  });

  test("avisos: pagada una factura con detracción, a Contabilidad le llega «por depositar»", () => {
    const comp = sql1(`select c.id from comprobantes c where c.detraccion > 0 and c.anulado_at is null
                        and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = c.id) limit 1`);
    const pago = sql1("select id from pagos order by id limit 1");
    test.skip(!comp || !pago, "sin una factura con detracción por pagar");
    const out = sqlScript(`begin;
      insert into pago_aplicaciones (pago_id, comprobante_id, monto) values (${pago}, ${comp}, 1);
      select count(*) from notificaciones n join perfiles p on p.user_id = n.user_id
       where p.rol in ('CONTABILIDAD', 'ASISTENTE_CONTABILIDAD') and n.tipo = 'DETRACCION_POR_PAGAR' and n.created_at > now() - interval '1 minute';
      rollback;`);
    expect(Number(out.at(-1)![0])).toBeGreaterThan(0);
  });

  test("solo Contabilidad: Tesorería no registra asientos, no contabiliza ni cierra", () => {
    const uid = uidDe("TESORERIA");
    for (const q of [
      `select registrar_asiento_manual(1, current_date, 'x', '[]'::jsonb)`,
      `select contabilizar_comprobantes(array[1]::bigint[])`,
      `select cerrar_periodo(1, '202001')`,
    ]) {
      expect(() =>
        sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                   set local role authenticated; ${q}; rollback;`),
      ).toThrow(/No tienes permiso/);
    }
  });
});

test.describe("@contabilidad archivos para SUNAT y vencimientos", () => {
  test("pago masivo de detracciones: cabecera de 68 y detalle de 107 caracteres, importes enteros", () => {
    const { nombre, contenido, total } = txtDetracciones({ ruc: "20100000001", razonSocial: "Empresa Demo S.A.C." }, "260001", [
      { ruc: "20100000002", proveedor: "PROVEEDOR UNO", cuenta: "00012345678", codigo: "037", monto: 41.4, periodo: "202611", serie: "E001", numero: "165" },
      { ruc: "20123456789", proveedor: "OTRO", cuenta: "00087654321", codigo: "030", monto: 360.5, periodo: "202610", serie: "F001", numero: "12345678901" },
    ]);
    expect(nombre).toBe("D20100000001260001.txt");
    const [cab, d1, d2, fin] = contenido.split("\r\n");
    expect(fin).toBe("");
    expect(cab).toHaveLength(68);
    expect(d1).toHaveLength(107);
    expect(d2).toHaveLength(107);
    expect(total).toBe(41 + 361);
    expect(cab).toBe(`*20100000001${"EMPRESA DEMO S.A.C.".padEnd(35)}260001${"402".padStart(13, "0")}00`);
    expect(d1.slice(0, 12)).toBe("620100000002");
    expect(d1.slice(12, 47)).toBe(" ".repeat(35));
    expect(d1.slice(47, 56)).toBe("000000000");
    expect(d1.slice(56, 59)).toBe("037");
    expect(d1.slice(59, 70)).toBe("00012345678");
    expect(d1.slice(70, 85)).toBe(`${"41".padStart(13, "0")}00`);
    expect(d1.slice(85, 87)).toBe("01");
    expect(d1.slice(87, 93)).toBe("202611");
    expect(d1.slice(93, 95)).toBe("01");
    expect(d1.slice(95, 99)).toBe("E001");
    expect(d1.slice(99, 107)).toBe("00000165");
    expect(d2.slice(99, 107), "número de más de 8: los últimos 8").toBe("45678901");
  });

  test("PLAME: .ps4 con el prestador y .4ta con cada recibo, separados por «|»", () => {
    const { ps4, cuarta } = archivosPlame("20100000001", "202611", [
      { documento: "10100000003", nombre: "Pérez Gómez Juan José", serie: "E001", numero: "11", total: 2074.83, emision: "2026-11-09", pago: "2026-11-09", retencion: 0 },
      { documento: "10100000003", nombre: "Pérez Gómez Juan José", serie: "E001", numero: "12", total: 3000, emision: "2026-11-02", pago: "2026-11-10", retencion: 240 },
    ]);
    expect(ps4.nombre).toBe("060120261120100000001.ps4");
    expect(cuarta.nombre).toBe("060120261120100000001.4ta");
    expect(ps4.contenido).toBe("06|10100000003|PEREZ|GOMEZ|JUAN JOSE|1|0|\r\n");
    expect(cuarta.contenido.split("\r\n")).toEqual([
      "06|10100000003|R|E001|11|2074.83|09/11/2026|09/11/2026|0||",
      "06|10100000003|R|E001|12|3000.00|02/11/2026|10/11/2026|1||",
      "",
    ]);
  });

  test("detracción: vence el 5.º día hábil del mes siguiente (sin fines de semana ni feriados)", () => {
    expect(quintoDiaHabil("202610"), "1/11 domingo y feriado").toBe("2026-11-06");
    expect(quintoDiaHabil("202612"), "1/1 feriado, cruza el año").toBe("2027-01-08");
    expect(quintoDiaHabil("202603"), "Jueves y Viernes Santo").toBe("2026-04-09");
  });
});

test.describe("@contabilidad libros y archivos: pantallas", () => {
  test("Diario: los asientos del mes como en la base, con su CSV; Mayor de una cuenta con su saldo", async ({ abrir, revisarPantalla }) => {
    const fila = sql("select empresa_id, to_char(max(fecha), 'YYYYMM') from asientos group by 1 order by max(fecha) desc limit 1")[0];
    test.skip(!fila, "sin asientos");
    const [e, mes] = fila;
    const n = Number(sql1(`select count(*) from asientos where empresa_id = ${e} and to_char(fecha, 'YYYYMM') = '${mes}'`));
    const page = await abrir("contabilidad", `/contabilidad/eeff?empresa=${e}&hasta=${mes}&vista=diario`);
    await revisarPantalla(page);
    await expect(page.locator("main section[aria-label^='Asiento ']")).toHaveCount(n);
    const csv = await page.request.get(`/contabilidad/eeff/diario?empresa=${e}&periodo=${mes}`);
    expect(csv.status()).toBe(200);
    const lineas = (await csv.text()).trim().split("\r\n");
    const nLineas = Number(sql1(`select count(*) from asiento_lineas l join asientos a on a.id = l.asiento_id where a.empresa_id = ${e} and to_char(a.fecha, 'YYYYMM') = '${mes}'`));
    expect(lineas).toHaveLength(nLineas + 1);
    await page.getByRole("tab", { name: "Mayor" }).click();
    await expect(page.getByRole("button", { name: "Cuenta", exact: true })).toBeVisible();
    await revisarPantalla(page);
  });

  test("asiento manual por la pantalla: no deja registrarlo descuadrado; registrado, se ve en el diario y se anula", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const e = empresa();
    const mes = sql1("select to_char((now() at time zone 'America/Lima')::date, 'YYYYMM')");
    const [d, h] = sql("select codigo from cuentas_contables order by codigo limit 2").map(([c]) => c);
    const glosa = `E2E apertura ${Date.now() % 100000}`;
    try {
      const page = await abrir("contabilidad", `/contabilidad/eeff?empresa=${e}&hasta=${mes}&vista=diario`);
      await page.getByRole("button", { name: "Nuevo asiento" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo asiento" });
      await hoja.getByLabel("Glosa").fill(glosa);
      for (const [i, cuenta] of [[1, d], [2, h]] as const) {
        await hoja.getByRole("button", { name: `Cuenta de la línea ${i}`, exact: true }).click();
        await page.getByRole("searchbox", { name: `Buscar Cuenta de la línea ${i}` }).fill(cuenta);
        await page.getByRole("listbox", { name: `Cuenta de la línea ${i}` }).getByRole("option").filter({ hasText: cuenta }).first().click();
      }
      await hoja.getByLabel("Debe").first().fill("250");
      await hoja.getByLabel("Haber").nth(1).fill("200");
      await expect(hoja.getByText(/^Falta: que cuadre$/)).toBeVisible();
      await expect(hoja.getByRole("button", { name: "Registrar asiento" })).toBeDisabled();
      await hoja.getByLabel("Haber").nth(1).fill("250");
      await hoja.getByRole("button", { name: "Registrar asiento" }).click();
      await expect(hoja).toBeHidden({ timeout: 15_000 });
      const seccion = page.locator("main section").filter({ hasText: glosa });
      await expect(seccion).toContainText("Manual");
      await seccion.getByRole("button", { name: "Anular el asiento" }).click();
      await page.getByRole("button", { name: "Sí", exact: true }).click();
      await expect(seccion).toHaveCount(0, { timeout: 15_000 });
    } finally {
      sql(`select set_config('app.skip_audit', 'on', false) is null;
           delete from asiento_lineas where asiento_id in (select id from asientos where glosa = '${glosa}');
           delete from asientos where glosa = '${glosa}';`);
    }
  });

  test("Compras: cerrar y reabrir el mes desde la pantalla", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const fila = sql(`select empresa_id, periodo from v_registro_compras where periodo < to_char((now() at time zone 'America/Lima')::date, 'YYYYMM')
                       group by 1, 2 order by 2 desc limit 1`)[0];
    test.skip(!fila, "sin un mes terminado con compras");
    const [e, mes] = fila;
    try {
      const page = await abrir("contabilidad", `/contabilidad/compras?empresa=${e}&periodo=${mes}`);
      await page.getByRole("button", { name: /^Cerrar / }).click();
      await page.getByRole("button", { name: "Sí", exact: true }).click();
      await expect(page.getByRole("button", { name: "Cerrado · Reabrir" })).toBeVisible({ timeout: 15_000 });
      expect(sql1(`select count(*) from periodos_cerrados where empresa_id = ${e} and periodo = '${mes}'`)).toBe("1");
      await page.getByRole("button", { name: "Cerrado · Reabrir" }).click();
      await page.getByRole("button", { name: "Sí", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Cerrar / })).toBeVisible({ timeout: 15_000 });
    } finally {
      sql(`delete from periodos_cerrados where empresa_id = ${e} and periodo = '${mes}'`);
    }
  });

  test("descargas: el TXT de detracciones (con su cuenta de detracciones) y el ZIP del PLAME", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "cambia una cuenta de proveedor");
    const det = sql(`select comprobante_id, proveedor_id, coalesce(cuenta_detracciones, ''), empresa_id from v_detracciones
                      where impuesto_pago_id is null and length(proveedor_ruc) = 11 limit 1`)[0];
    const plame = sql(`select c.empresa_id, to_char(max(p.fecha), 'YYYYMM') from comprobantes c join pago_aplicaciones a on a.comprobante_id = c.id
                        join pagos p on p.id = a.pago_id where c.tipo = 'RXH' and c.anulado_at is null group by c.id, c.empresa_id limit 1`)[0];
    const page = await abrir("contabilidad", "/contabilidad/impuestos");
    if (det) {
      const [id, prov, cuentaAntes] = det;
      try {
        const sin = await page.request.get(`/contabilidad/impuestos/detracciones?ids=${id}&lote=260001`);
        if (!cuentaAntes) expect((await sin.text()).toString()).toMatch(/falta su cuenta de detracciones/);
        sql(`update proveedores set cuenta_detracciones = '00012345678' where id = ${prov}`);
        const r = await page.request.get(`/contabilidad/impuestos/detracciones?ids=${id}&lote=260001&codigos=${id}:037`);
        expect(r.status()).toBe(200);
        expect(r.headers()["content-disposition"]).toMatch(/filename="D\d{11}260001\.txt"/);
        const [cab, d1] = (await r.text()).split("\r\n");
        expect(cab).toHaveLength(68);
        expect(d1).toHaveLength(107);
        expect(d1.slice(56, 59)).toBe("037");
      } finally {
        sql(`update proveedores set cuenta_detracciones = ${cuentaAntes ? `'${cuentaAntes}'` : "null"} where id = ${prov}`);
      }
    }
    if (plame) {
      const [e, mes] = plame;
      const r = await page.request.get(`/contabilidad/impuestos/plame?empresa=${e}&periodo=${mes}`);
      expect(r.status()).toBe(200);
      const archivos = unzipSync(new Uint8Array(await r.body()));
      const nombres = Object.keys(archivos).sort();
      expect(nombres).toHaveLength(2);
      expect(nombres[0]).toMatch(/^0601\d{6}\d{11}\.4ta$/);
      expect(nombres[1]).toMatch(/^0601\d{6}\d{11}\.ps4$/);
      expect(strFromU8(archivos[nombres[0]]).split("\r\n")[0]).toMatch(/^0[16]\|\d+\|R\|/);
    }
  });
});
