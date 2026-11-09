import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Contabilidad paga las detracciones (por comprobante, a la cuenta de detracciones del proveedor) y las retenciones de 4ta
// (por empresa y mes del pago del recibo) con su constancia (migración prod1_pagos_impuestos). Lo de la base corre en una
// transacción revertida; lo de las pantallas, solo en m390, y se limpia al final.

const PDF = { name: "constancia-e2e.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") };
const LENTO = { timeout: 20_000 };

/** Sentencias como `uid` dentro de una transacción revertida, con la constancia `path` ya subida. Devuelve, por cada
 * sentencia, «ok: <resultado>» o «error: <mensaje>» (el «|» separa columnas); `despues` lee como postgres al final. */
function probar(uid: string, path: string, sentencias: string[], despues = "select 'fin'") {
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
    insert into storage.objects (bucket_id, name) values ('documentos', '${path}');
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
    ${cuerpo}
    select ${sentencias.map((_, i) => `current_setting('e2e.r${i}')`).join(", ")};
    ${despues};
    rollback;`);
  return { r: out.at(-2)!, despues: out.at(-1)! };
}

const pendiente = (extra = "") =>
  sql(`select comprobante_id, empresa_id, detraccion from v_detracciones where impuesto_pago_id is null ${extra} order by comprobante_id limit 1`)[0];

test.describe("@contabilidad pago de detracciones y retenciones: la base", () => {
  test("detracción: solo Contabilidad, con su constancia y una vez; genera el asiento y bloquea el comprobante hasta anularla", () => {
    const d = pendiente();
    test.skip(!d, "sin detracciones por pagar");
    const [id, empresa, monto] = d;
    const otra = sql1(`select comprobante_id from v_detracciones where impuesto_pago_id is null and empresa_id <> ${empresa} limit 1`);
    const sinDetraccion = sql1("select id from comprobantes where coalesce(detraccion, 0) = 0 and anulado_at is null limit 1");
    const path = `impuestos/${empresa}/e2e-constancia.pdf`;
    const pagar = (ids: string, archivo = path, numero = "E2E-1") =>
      `select registrar_pago_detraccion(array[${ids}]::bigint[], current_date, '${numero}', '${archivo}')::text`;
    const con = uidDe("CONTABILIDAD");

    const teso = probar(uidDe("TESORERIA"), path, [pagar(id)]);
    expect(teso.r[0], "Tesorería no").toMatch(/^error: No tienes permiso/);

    const { r, despues } = probar(
      con,
      path,
      [
        pagar(id, `impuestos/${empresa}/no-existe.pdf`),
        pagar(id, `pagos/${empresa}/x.pdf`),
        pagar(sinDetraccion),
        ...(otra ? [pagar(`${id}, ${otra}`)] : []),
        pagar(id),
        pagar(id, path, "E2E-2"),
      ],
      `do $$ begin
         update comprobantes set detraccion = detraccion + 1 where id = ${id};
         perform set_config('e2e.cambio', 'cambió', true);
       exception when others then perform set_config('e2e.cambio', sqlerrm, true); end $$;
       select current_setting('e2e.cambio') || '|' || (select monto from impuesto_pagos where numero = 'E2E-1')
              || '|' || (select sum(debe) || '/' || sum(haber) from asiento_lineas l join asientos s on s.id = l.asiento_id
                          join impuesto_pagos p on p.id = s.impuesto_pago_id where p.numero = 'E2E-1')
              || '|' || (select string_agg(distinct cuenta, ',' order by cuenta) from asiento_lineas l join asientos s on s.id = l.asiento_id
                          join impuesto_pagos p on p.id = s.impuesto_pago_id where p.numero = 'E2E-1')`,
    );
    let i = 0;
    expect(r[i++], "constancia no subida").toBe("error: Constancia inválida");
    expect(r[i++], "fuera de su carpeta").toBe("error: Constancia inválida");
    expect(r[i++]).toMatch(/^error: El comprobante .* no lleva detracción$/);
    if (otra) expect(r[i++]).toBe("error: Las detracciones de un pago deben ser de una misma empresa");
    expect(r[i++]).toMatch(/^ok: \d+$/);
    expect(r[i++], "dos veces no").toMatch(/^error: La detracción del comprobante .* ya está pagada$/);
    const [cambio, pagado, cuadre, cuentas] = despues;
    expect(cambio, "con la detracción pagada no cambia").toMatch(/^Contabilidad ya pagó la detracción del comprobante/);
    expect(Number(pagado)).toBe(Number(monto));
    expect(cuadre).toBe(`${Number(monto).toFixed(2)}/${Number(monto).toFixed(2)}`);
    expect(cuentas).toBe("1041,421210101");
  });

  test("anular el pago (con motivo, una vez) libera la detracción y borra su asiento", () => {
    const d = pendiente();
    test.skip(!d, "sin detracciones por pagar");
    const [id, empresa] = d;
    const path = `impuestos/${empresa}/e2e-constancia.pdf`;
    const pago = `(select id from impuesto_pagos where numero = 'E2E-A')`;
    const { r, despues } = probar(
      uidDe("CONTABILIDAD"),
      path,
      [
        `select registrar_pago_detraccion(array[${id}]::bigint[], current_date, 'E2E-A', '${path}')::text`,
        `select anular_pago_impuesto(${pago}, '')::text`,
        `select anular_pago_impuesto(${pago}, 'E2E prueba')::text`,
        `select anular_pago_impuesto(${pago}, 'E2E prueba')::text`,
      ],
      `select (select count(*) from asientos where impuesto_pago_id = ${pago})
              || '|' || (select count(*) from v_detracciones where comprobante_id = ${id} and impuesto_pago_id is null)`,
    );
    expect(r[0]).toMatch(/^ok: /);
    expect(r[1]).toBe("error: Ingresa el motivo");
    expect(r[2]).toBe("ok: ");
    expect(r[3]).toBe("error: El pago ya está anulado");
    expect(despues, "sin asiento y otra vez por pagar").toEqual(["0", "1"]);
  });

  test("retención de 4ta: todo lo retenido del mes, solo si el monto es el que se vio", () => {
    const g = sql(`select empresa_id, periodo, sum(retencion) from v_retenciones_4ta where impuesto_pago_id is null
                   group by 1, 2 order by 2 desc limit 1`)[0];
    test.skip(!g, "sin retenciones por pagar");
    const [empresa, periodo, total] = g;
    const path = `impuestos/${empresa}/e2e-constancia.pdf`;
    const pagar = (monto: string, per = periodo) =>
      `select registrar_pago_retencion(${empresa}, '${per}', ${monto}, current_date, 'E2E-R', '${path}')::text`;
    const { r, despues } = probar(
      uidDe("CONTABILIDAD"),
      path,
      [pagar(`${total} + 1`), pagar(total), pagar(total), pagar("1", "200001")],
      `select (select count(*) from v_retenciones_4ta where empresa_id = ${empresa} and periodo = '${periodo}' and impuesto_pago_id is null)
              || '|' || (select string_agg(distinct cuenta, ',' order by cuenta) from asiento_lineas l join asientos s on s.id = l.asiento_id
                          join impuesto_pagos p on p.id = s.impuesto_pago_id where p.numero = 'E2E-R')`,
    );
    expect(r[0]).toMatch(/^error: Las retenciones del periodo cambiaron: ahora suman S\/ /);
    expect(r[1]).toMatch(/^ok: \d+$/);
    expect(r[2], "ya no queda nada de ese mes").toBe("error: No hay retenciones por pagar de ese periodo");
    expect(r[3]).toBe("error: No hay retenciones por pagar de ese periodo");
    expect(despues).toEqual(["0", "1041,401720101"]);
  });

  test("las constancias: las sube solo Contabilidad y no las lee el Jefe de Operaciones; los pagos tampoco", () => {
    const leer = (rol: string) =>
      sqlScript(`begin;
        select set_config('request.jwt.claims', '{"sub":"${uidDe(rol)}","role":"authenticated"}', true) is null;
        set local role authenticated;
        select (select count(*) from impuesto_pagos) || '|' || (select count(*) from v_detracciones);
        rollback;`).at(-1)!;
    expect(leer("JEFE_OPERACIONES")).toEqual(["0", "0"]);
    expect(Number(leer("CONTABILIDAD")[1])).toBeGreaterThan(0);
    const subir = (rol: string) => {
      try {
        sqlScript(`begin;
          select set_config('request.jwt.claims', '{"sub":"${uidDe(rol)}","role":"authenticated"}', true) is null;
          set local role authenticated;
          insert into storage.objects (bucket_id, name, owner_id) values ('documentos', 'impuestos/1/e2e.pdf', '${uidDe(rol)}');
          rollback;`);
        return "subió";
      } catch {
        return "no";
      }
    };
    expect(subir("CONTABILIDAD")).toBe("subió");
    expect(subir("TESORERIA")).toBe("no");
    expect(subir("LOGISTICA")).toBe("no");
  });
});

test.describe("@contabilidad pago de detracciones y retenciones: pantallas", () => {
  const limpiar = (where: string) =>
    sqlScript(`select set_config('app.skip_audit', 'on', false) is null;
      delete from asiento_lineas where asiento_id in (select s.id from asientos s join impuesto_pagos p on p.id = s.impuesto_pago_id where ${where});
      delete from asientos where impuesto_pago_id in (select id from impuesto_pagos p where ${where});
      delete from impuesto_pagos p where ${where};
      set storage.allow_delete_query = 'true';
      delete from storage.objects where bucket_id = 'documentos' and name like 'impuestos/%constancia-e2e%';`);

  test("Contabilidad pone la cuenta de detracciones, paga una detracción con su constancia, la ve pagada y la anula", async ({ abrir, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const d = sql(`select comprobante_id, proveedor_id, coalesce(cuenta_detracciones, ''), serie || '-' || numero, empresa_id
                   from v_detracciones where impuesto_pago_id is null order by comprobante_id desc limit 1`)[0];
    test.skip(!d, "sin detracciones por pagar");
    const [id, proveedor, cuentaAntes, documento, empresa] = d;
    const numero = `E2E${Date.now() % 1_000_000}`;
    try {
      const page = await abrir("contabilidad", `/contabilidad/impuestos?imp=det&est=pend&empresa=${empresa}`);
      await expect(page.getByRole("link", { name: "Impuestos" })).toHaveAttribute("aria-current", "page");
      await revisarPantalla(page);
      const fila = page.locator("main li").filter({ hasText: documento });

      // La cuenta de detracciones del proveedor.
      await fila.getByRole("button", { name: /Cta\. detracciones|Sin cuenta de detracciones/ }).click();
      const hojaCuenta = page.getByRole("dialog");
      await hojaCuenta.getByLabel("Cuenta de detracciones (Banco de la Nación)").fill("00-012-345678");
      await hojaCuenta.getByRole("button", { name: "Guardar" }).click();
      await expect(fila.getByRole("button", { name: "Cta. detracciones 00012345678" })).toBeVisible(LENTO);
      expect(sql1(`select cuenta_detracciones from proveedores where id = ${proveedor}`)).toBe("00012345678");

      // Elegirla y pagarla.
      await fila.getByRole("checkbox").check();
      await page.getByRole("button", { name: /^Pagar 1 · S\// }).click();
      const hoja = page.getByRole("dialog", { name: `Detracción ${documento}` });
      const registrar = hoja.getByRole("button", { name: /^Registrar pago/ });
      await expect(registrar).toBeDisabled();
      await expect(hoja.getByText("Falta: n° de constancia, constancia")).toBeVisible();
      await hoja.getByLabel("N° de constancia").fill(numero);
      await hoja.getByLabel("Constancia", { exact: true }).setInputFiles(PDF);
      await revisarPantalla(page);
      await registrar.click();
      await expect(hoja).toBeHidden(LENTO);
      await expect(fila).toHaveCount(0);
      expect(sql1(`select count(*) from v_detracciones where comprobante_id = ${id} and constancia = '${numero}'`)).toBe("1");

      // Pagadas: la constancia, el comprobante y el asiento; se anula con motivo.
      await page.getByRole("tab", { name: "Pagadas" }).click();
      await page.locator("main li button").filter({ hasText: numero }).click();
      const pago = page.getByRole("dialog", { name: `Detracción ${numero}` });
      await expect(pago.getByText("Constancia", { exact: true }).first()).toBeVisible(LENTO);
      await expect(pago.getByRole("list", { name: "Comprobantes" })).toContainText(documento);
      await expect(pago.getByText("421210101").first()).toBeVisible(LENTO);
      await pago.getByRole("button", { name: "Anular", exact: true }).click();
      await expect(pago.getByText("Falta: motivo")).toBeVisible();
      await pago.getByLabel("Motivo de la anulación").fill("E2E prueba");
      await pago.getByRole("button", { name: "Anular el pago" }).click();
      await expect(pago).toBeHidden(LENTO);
      expect(sql1(`select count(*) from v_detracciones where comprobante_id = ${id} and impuesto_pago_id is null`)).toBe("1");
    } finally {
      limpiar(`p.numero = '${numero}'`);
      sql(`update proveedores set cuenta_detracciones = ${cuentaAntes ? `'${cuentaAntes}'` : "null"} where id = ${proveedor}`);
    }
  });

  test("Contabilidad paga las retenciones de 4ta de un mes con su constancia", async ({ abrir, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const g = sql(`select empresa_id, periodo, sum(retencion), count(*) from v_retenciones_4ta where impuesto_pago_id is null
                   group by 1, 2 order by 1, 2 limit 1`)[0];
    test.skip(!g, "sin retenciones por pagar");
    const [empresa, periodo, total, n] = g;
    const numero = `E2E${Date.now() % 1_000_000}`;
    try {
      const page = await abrir("contabilidad", `/contabilidad/impuestos?imp=ret&est=pend&empresa=${empresa}`);
      await page.locator("main li button").first().click();
      const hoja = page.getByRole("dialog", { name: /^Retenciones / });
      await expect(hoja.getByRole("list", { name: "Recibos" }).locator("li")).toHaveCount(Number(n));
      await hoja.getByLabel("N° de orden u operación").fill(numero);
      await hoja.getByLabel("Constancia", { exact: true }).setInputFiles(PDF);
      await revisarPantalla(page);
      await hoja.getByRole("button", { name: /^Registrar pago/ }).click();
      await expect(hoja).toBeHidden(LENTO);
      expect(sql1(`select monto || ' ' || periodo from impuesto_pagos where numero = '${numero}'`)).toBe(`${Number(total).toFixed(2)} ${periodo}`);
      expect(sql1(`select count(*) from v_retenciones_4ta where empresa_id = ${empresa} and periodo = '${periodo}' and impuesto_pago_id is null`)).toBe("0");
    } finally {
      limpiar(`p.numero = '${numero}'`);
    }
  });
});
