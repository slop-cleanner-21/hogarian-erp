import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Prod 1: la OS se crea con su comprobante (define el contrato) y la fecha de inicio; el N° no se escribe;
// la OC sin guía pasa directo a Tesorería al facturarla; retención de 4ta por proveedor y su suspensión;
// DNI y firma de Gerencia. Lo que se escribe se revierte al final.

const hoyLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const masDias = (iso: string, d: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + d * 864e5).toISOString().slice(0, 10);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("@prod1 @logistica OS con comprobante y fecha de inicio", () => {
  test("N° fijo, comprobante del proveedor por defecto, inicio no posterior a hoy, y la OS queda con ellos", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [obra, descripcion] = sql(
      `select p.obra_id, p.descripcion from v_partidas p join obras o on o.id = p.obra_id
        where p.rubro = 'SUBCONTRATO' and o.estado <> 'CERRADA' and o.presupuesto_estado = 'PUBLICADO' and p.saldo_cant > 1
        order by p.obra_id desc, p.id limit 1`,
    )[0];
    const [, proveedor] = sql(`select id, razon_social from proveedores where comprobante_habitual = 'FACTURA' order by id limit 1`)[0];
    const siguiente = sql1(`select siguiente_numero_oc(${obra})`);
    try {
      const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
      await page.getByPlaceholder("Buscar partida").fill(descripcion.slice(0, 25));
      await page.locator("main label").filter({ hasText: descripcion }).first().locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: /^Continuar/ }).click();

      // El N° se ve pero no se escribe.
      const main = page.locator("main");
      await expect(main.getByText(siguiente, { exact: true })).toBeVisible();
      await expect(main.getByRole("textbox", { name: "N° orden" })).toHaveCount(0);

      await main.getByRole("button", { name: "Proveedor", exact: true }).click();
      await page.getByLabel("Buscar Proveedor").fill(proveedor.slice(0, 20));
      await page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").filter({ hasText: new RegExp(`^${escRe(proveedor)}`) }).first().click();
      await expect(main.getByRole("button", { name: "Comprobante", exact: true })).toHaveText(/Factura/);

      const confirmar = page.getByRole("button", { name: "Confirmar" });
      await expect(confirmar, "sin fecha de inicio").toBeDisabled();
      await main.getByLabel("Fecha de inicio").fill(masDias(hoyLima(), 1));
      await expect(main.getByText(/no puede ser posterior/)).toBeVisible();
      await expect(confirmar).toBeDisabled();
      const inicio = masDias(hoyLima(), -6);
      await main.getByLabel("Fecha de inicio").fill(inicio);
      await expect(confirmar).toBeEnabled();
      await confirmar.click();
      await page.getByRole("dialog").filter({ hasText: `¿Emitir OS ${siguiente}?` }).getByRole("button", { name: "Sí" }).click();
      await page.waitForURL(new RegExp(`/logistica/ordenes/${obra}/${siguiente}`));
      expect(sql1(`select comprobante_tipo || ' ' || fecha_inicio from ordenes_compra where obra_id = ${obra} and numero = '${siguiente}'`)).toBe(`FACTURA ${inicio}`);
    } finally {
      sql(`delete from oc_items where obra_id = ${obra} and numero_oc = '${siguiente}'; delete from ordenes_compra where obra_id = ${obra} and numero = '${siguiente}';`);
    }
  });

  test("la base no acepta un inicio posterior a la fecha de la OS ni otro comprobante que factura o RHE", async () => {
    const [obra, numero, fecha] = sql(`select obra_id, numero, fecha from ordenes_compra where tipo = 'OS' and estado = 'PRECIOS_CONFIRMADOS' order by obra_id, numero limit 1`)[0];
    const uid = uidDe("LOGISTICA");
    const como = (q: string) =>
      sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                 set local role authenticated; ${q}; rollback;`);
    expect(() => como(`select set_datos_os(${obra}, '${numero}', 'RXH', '${fecha}'::date + 1)`)).toThrow(/posterior/);
    expect(() => como(`select set_datos_os(${obra}, '${numero}', 'BOLETA', null)`)).toThrow(/factura o recibo/);
  });
});

test.describe("@prod1 @logistica facturar: guía y retención", () => {
  test("OC sin guía: al registrar la factura pasa directo a Tesorería", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o join proveedores p on p.id = o.proveedor_id
        where o.tipo = 'OC' and o.estado = 'PRECIOS_CONFIRMADOS' and not o.requiere_guia and not o.historico and p.comprobante_habitual = 'FACTURA'
          and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        order by o.obra_id, o.numero limit 1`,
    )[0];
    test.skip(!fila, "no hay OC con precios confirmados sin facturar");
    const [obra, numero] = fila;
    const serie = "F999";
    const num = String(Date.now() % 100000000);
    try {
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}?tipo=OC`);
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = page.getByRole("dialog", { name: "Comprobante" });
      await expect(hoja.getByLabel("Requiere guía de remisión")).not.toBeChecked();
      await hoja.getByLabel("Serie").fill(serie);
      await hoja.getByLabel("Número").fill(num);
      // Orden normal: sin el archivo de la factura no se registra.
      await expect(hoja.getByRole("button", { name: /^Registrar/ })).toBeDisabled();
      await hoja.locator('input[type="file"]').setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      // Marcar la guía cambia el botón: ya no se envía solo.
      await hoja.getByLabel("Requiere guía de remisión").check();
      await expect(hoja.getByRole("button", { name: "Registrar", exact: true })).toBeVisible();
      await hoja.getByLabel("Requiere guía de remisión").uncheck();
      await hoja.getByRole("button", { name: "Registrar y enviar a Tesorería" }).click();
      await expect(hoja).toBeHidden();
      await expect.poll(() => sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("EN_TESORERIA");
    } finally {
      sql(`update oc_items set comprobante_id = null where obra_id = ${obra} and numero_oc = '${numero}';
           delete from comprobantes where serie = '${serie}' and numero = '${num}';
           update ordenes_compra set estado = 'PRECIOS_CONFIRMADOS' where obra_id = ${obra} and numero = '${numero}';
           delete from notificaciones where href like '%/${obra}/${numero}' and created_at > now() - interval '10 minutes';`);
    }
  });

  test("OS facturada: al subir el contrato firmado va sola a Tesorería", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o
        where o.tipo = 'OS' and o.estado = 'FACTURADA' and not o.es_retencion
          and not exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero)
        order by o.obra_id desc, o.numero limit 1`,
    )[0];
    test.skip(!fila, "no hay OS facturada sin contrato firmado");
    const [obra, numero] = fila;
    try {
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}?tipo=OS`);
      // Otro archivo que el comprobante (las demos usan esta misma imagen como factura): el contrato no puede ser la factura.
      const contrato = Buffer.concat([fs.readFileSync(path.resolve("tests/e2e/archivos/ariant.png")), Buffer.from("contrato")]);
      await page.locator('#contrato input[type="file"]').setInputFiles({ name: "contrato-firmado.png", mimeType: "image/png", buffer: contrato });
      await expect.poll(() => sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`), { timeout: 15_000 }).toBe("EN_TESORERIA");
    } finally {
      sql(`delete from adjuntos where tipo = 'CONTRATO' and obra_id = ${obra} and numero_oc = '${numero}';
           update ordenes_compra set estado = 'FACTURADA' where obra_id = ${obra} and numero = '${numero}';
           delete from notificaciones where href like '%/${obra}/${numero}' and created_at > now() - interval '10 minutes';`);
    }
  });

  test("el contrato firmado no puede ser el comprobante de la orden: avisa y la orden no se mueve", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const fila = sql(
      `select o.obra_id, o.numero, min(i.comprobante_id) from ordenes_compra o join oc_items i on i.obra_id = o.obra_id and i.numero_oc = o.numero
        where o.tipo = 'OS' and o.estado = 'FACTURADA' and not o.es_retencion and i.comprobante_id is not null
          and not exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero)
        group by 1, 2 order by o.obra_id desc, o.numero limit 1`,
    )[0];
    test.skip(!fila, "no hay OS facturada sin contrato firmado");
    const [obra, numero, comp] = fila;
    const env = Object.fromEntries(
      fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
    );
    const sb = "http://127.0.0.1:55321";
    const auth = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` };
    const archivo = path.resolve("tests/e2e/archivos/ariant.png");
    const ruta = `e2e/contrato-igual-${Date.now()}.png`;
    const antes = sql1(`select coalesce(archivo_path, '') from comprobantes where id = ${comp}`);
    // El comprobante de la orden pasa a ser ese mismo archivo.
    const r = await fetch(`${sb}/storage/v1/object/comprobantes/${ruta}`, { method: "POST", headers: { ...auth, "Content-Type": "image/png" }, body: fs.readFileSync(archivo) });
    expect(r.ok).toBe(true);
    try {
      sql(`select set_config('app.skip_audit', 'on', false) is null; update comprobantes set archivo_path = '${ruta}' where id = ${comp}`);
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}?tipo=OS`);
      await page.locator('#contrato input[type="file"]').setInputFiles(archivo);
      await expect(page.getByText(/^Ese archivo es el comprobante .* de la orden, no el contrato/)).toBeVisible({ timeout: 15_000 });
      expect(sql1(`select count(*) from adjuntos where tipo = 'CONTRATO' and obra_id = ${obra} and numero_oc = '${numero}'`)).toBe("0");
      expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("FACTURADA");
    } finally {
      sql(`select set_config('app.skip_audit', 'on', false) is null; update comprobantes set archivo_path = ${antes ? `'${antes}'` : "null"} where id = ${comp}`);
      await fetch(`${sb}/storage/v1/object/comprobantes`, { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [ruta] }) });
    }
  });

  test("RHE: 8 % del proveedor sobre S/ 1,500, nada con suspensión vigente, y aviso si cambia el contrato", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "cambia el proveedor");
    const fila = sql(
      `select o.obra_id, o.numero, o.proveedor_id, coalesce(o.comprobante_tipo::text, '') from ordenes_compra o
        where o.tipo = 'OS' and o.estado = 'PRECIOS_CONFIRMADOS' and not o.es_retencion and o.valorizacion_id is null
          and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        order by o.obra_id, o.numero limit 1`,
    )[0];
    test.skip(!fila, "no hay OS con precios confirmados sin facturar");
    const [obra, numero, prov, antes] = fila;
    const [pct, fechaS, pathS, opS] = sql(`select retencion_4ta_pct, coalesce(suspension_4ta_fecha::text, ''), coalesce(suspension_4ta_path, ''), coalesce(suspension_4ta_operacion, '') from proveedores where id = ${prov}`)[0];
    try {
      sql(`update proveedores set retencion_4ta_pct = 8, suspension_4ta_fecha = null, suspension_4ta_path = null, suspension_4ta_operacion = null where id = ${prov};
           update ordenes_compra set comprobante_tipo = 'RXH' where obra_id = ${obra} and numero = '${numero}'`);
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}?tipo=OS`);
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = page.getByRole("dialog", { name: "Comprobante" });
      await expect(hoja.getByRole("button", { name: "Tipo de comprobante" })).toHaveText(/Recibo por honorarios/);
      await hoja.getByLabel("Total").fill("2000");
      await expect(hoja.getByLabel("Retención 4ta (8 %)")).toHaveValue("S/ 160.00");
      await hoja.getByLabel("Total").fill("1500");
      await expect(hoja.getByLabel("Retención 4ta (8 %)")).toHaveValue("S/ 0.00");
      // Otro comprobante: el contrato se regenera.
      await hoja.getByRole("button", { name: "Tipo de comprobante" }).click();
      await page.getByRole("listbox", { name: "Tipo de comprobante" }).getByRole("option", { name: "Factura", exact: true }).click();
      await expect(hoja.getByText(/el contrato pasa a ser comercial/)).toBeVisible();

      // Con suspensión vigente (otorgada este año), no se retiene.
      sql(`update proveedores set suspension_4ta_fecha = date_trunc('year', now() at time zone 'America/Lima')::date, suspension_4ta_path = 'proveedores/e2e/constancia.pdf' where id = ${prov}`);
      await page.reload();
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      await hoja.getByRole("button", { name: "Tipo de comprobante" }).click();
      await page.getByRole("listbox", { name: "Tipo de comprobante" }).getByRole("option", { name: "Recibo por honorarios", exact: true }).click();
      await hoja.getByLabel("Total").fill("2000");
      await expect(hoja.getByLabel(/^Retención 4ta · suspendida/)).toHaveValue("S/ 0.00");

      // Una suspensión del año pasado ya no vale (vence el 31 de diciembre): vuelve a retener.
      sql(`update proveedores set suspension_4ta_fecha = (date_trunc('year', now() at time zone 'America/Lima') - interval '1 day')::date where id = ${prov}`);
      await page.reload();
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      await hoja.getByRole("button", { name: "Tipo de comprobante" }).click();
      await page.getByRole("listbox", { name: "Tipo de comprobante" }).getByRole("option", { name: "Recibo por honorarios", exact: true }).click();
      await hoja.getByLabel("Total").fill("2000");
      await expect(hoja.getByLabel("Retención 4ta (8 %)")).toHaveValue("S/ 160.00");

      // Con el % propio del proveedor (Logística lo cambia en su ficha): 10 % de S/ 2,000.
      sql(`update proveedores set retencion_4ta_pct = 10, suspension_4ta_fecha = null, suspension_4ta_path = null, suspension_4ta_operacion = null where id = ${prov}`);
      await page.reload();
      await page.getByRole("button", { name: "Registrar comprobante" }).click();
      await hoja.getByRole("button", { name: "Tipo de comprobante" }).click();
      await page.getByRole("listbox", { name: "Tipo de comprobante" }).getByRole("option", { name: "Recibo por honorarios", exact: true }).click();
      await hoja.getByLabel("Total").fill("2000");
      await expect(hoja.getByLabel("Retención 4ta (10 %)")).toHaveValue("S/ 200.00");
    } finally {
      sql(`update proveedores set retencion_4ta_pct = ${pct}, suspension_4ta_fecha = ${fechaS ? `'${fechaS}'` : "null"}, suspension_4ta_path = ${pathS ? `'${pathS}'` : "null"}, suspension_4ta_operacion = ${opS ? `'${opS}'` : "null"} where id = ${prov};
           update ordenes_compra set comprobante_tipo = ${antes ? `'${antes}'` : "null"} where obra_id = ${obra} and numero = '${numero}'`);
    }
  });

  test("proveedor: la suspensión de 4ta solo se guarda con la constancia y su fecha", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [id, ruc, razon] = sql(`select id, ruc_o_cod, razon_social from proveedores where comprobante_habitual = 'RXH' and suspension_4ta_fecha is null order by id limit 1`)[0];
    try {
      const page = await abrir("logistica", `/logistica/proveedores?q=${encodeURIComponent(ruc)}`);
      await page.locator("main").getByRole("button", { name: new RegExp(escRe(razon)) }).first().click();
      const hoja = page.getByRole("dialog", { name: "Proveedor" });
      const seccion = hoja.getByRole("region", { name: "Retención de 4ta" });
      await expect(seccion.getByLabel("Retención 4ta (%)")).toHaveValue("8");
      await seccion.getByLabel("Suspensión de 4ta categoría").check();
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja.getByRole("alert")).toHaveText(/constancia/);
      await seccion.getByLabel("Fecha de la constancia").fill(hoyLima());
      await expect(seccion).toContainText(`Vigente hasta el 31/12/${hoyLima().slice(0, 4)}`);
      await seccion.locator('input[type="file"]').setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql1(`select suspension_4ta_fecha || ' ' || (suspension_4ta_path like 'proveedores/${ruc}/suspension-4ta-%') from proveedores where id = ${id}`)).toBe(`${hoyLima()} true`);
    } finally {
      sql(`update proveedores set suspension_4ta_fecha = null, suspension_4ta_path = null where id = ${id}`);
    }
  });
});

test.describe("@prod1 @gerencia firma y DNI", () => {
  // Una a la vez: una cambia quién firma por una empresa, y la otra vería «Mi firma» por empresa.
  test.describe.configure({ mode: "serial" });
  test("firma por empresa: el gerente que firma por ella la sube y la cambia; va en el contrato", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const uid = sql1(`select id from auth.users where email = 'gerencia@erp.local'`);
    const [empresa, nombre, antes] = sql(`select id, nombre, coalesce(firmante_id::text, '') from empresas order by id limit 1`)[0];
    sql(`update empresas set firmante_id = '${uid}' where id = ${empresa}`);
    try {
      const page = await abrir("gerencia", "/gerencia/obras");
      await page.getByRole("button", { name: "Usuario" }).click();
      await page.getByRole("button", { name: "Mi firma" }).click();
      const hoja = page.getByRole("dialog", { name: "Mi firma" });
      const bloque = hoja.getByRole("region", { name: `Firma ${nombre}` });
      await expect(bloque).toBeVisible();
      await bloque.locator('input[type="file"]').setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      await bloque.getByRole("button", { name: "Guardar firma" }).click();
      await expect(bloque.getByRole("status")).toHaveText("Guardada");
      expect(sql1(`select (path like 'firmas/empresa-${empresa}-%') || ' ' || (subida_por = '${uid}') from empresa_firmas where empresa_id = ${empresa}`)).toBe("true true");
      // Otra la reemplaza (se puede cambiar).
      const primera = sql1(`select path from empresa_firmas where empresa_id = ${empresa}`);
      await bloque.locator('input[type="file"]').setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      await bloque.getByRole("button", { name: "Guardar firma" }).click();
      await expect.poll(() => sql1(`select path from empresa_firmas where empresa_id = ${empresa}`)).not.toBe(primera);
    } finally {
      sql(`delete from empresa_firmas where empresa_id = ${empresa}; update empresas set firmante_id = ${antes ? `'${antes}'` : "null"} where id = ${empresa};`);
    }
  });

  test("Gerencia sube su firma desde su menú; el Admin exige el DNI de Gerencia", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const uid = sql1(`select id from auth.users where email = 'gerencia@erp.local'`);
    const antes = sql(`select coalesce(dni, ''), coalesce(firma_path, '') from perfil_privado where user_id = '${uid}'`)[0];
    try {
      const page = await abrir("gerencia", "/gerencia/obras");
      await page.getByRole("button", { name: "Usuario" }).click();
      await page.getByRole("button", { name: "Mi firma" }).click();
      const hoja = page.getByRole("dialog", { name: "Mi firma" });
      await expect(hoja.getByText("Sin firma").or(hoja.getByRole("img", { name: "Firma" }))).toBeVisible();
      await hoja.locator('input[type="file"]').setInputFiles(path.resolve("tests/e2e/archivos/ariant.png"));
      await expect(hoja.getByRole("img", { name: "Firma" })).toBeVisible();
      await hoja.getByRole("button", { name: "Guardar firma" }).click();
      await expect(hoja.getByRole("status")).toHaveText("Guardada");
      await hoja.getByRole("button", { name: "Cerrar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql1(`select firma_path like 'firmas/${uid}-%' from perfil_privado where user_id = '${uid}'`)).toBe("t");

      // El Admin: Gerencia sin DNI no se guarda; con 8 dígitos sí.
      const admin = await abrir("admin", "/admin");
      await admin.locator("main").getByRole("button", { name: /(^|[^\w-])gerencia@erp\.local/ }).click();
      const ficha = admin.getByRole("dialog", { name: "Gerencia" });
      await ficha.getByLabel("DNI").fill("4123");
      await expect(ficha.getByRole("button", { name: "Guardar" })).toBeDisabled();
      await ficha.getByLabel("DNI").fill("41234567");
      await ficha.getByRole("button", { name: "Guardar" }).click();
      await expect(ficha).toBeHidden();
      expect(sql1(`select dni from perfil_privado where user_id = '${uid}'`)).toBe("41234567");
    } finally {
      sql(
        antes
          ? `update perfil_privado set dni = ${antes[0] ? `'${antes[0]}'` : "null"}, firma_path = ${antes[1] ? `'${antes[1]}'` : "null"} where user_id = '${uid}'`
          : `delete from perfil_privado where user_id = '${uid}'`,
      );
    }
  });
});

test.describe("@prod1 datos históricos (Excel)", () => {
  test("la carga del Excel queda marcada como histórica y lo de la app como normal", () => {
    // Sin autor y fuera de las obras DEMO: del Excel. Con autor: creado en la app.
    // Sin lo que otras pruebas están creando en este momento (por SQL, sin autor): la carga es anterior.
    const viejas = "o.created_at < now() - interval '10 minutes'";
    expect(sql1(`select count(*) from ordenes_compra o join obras b on b.id = o.obra_id where b.nombre not like 'DEMO%' and b.nombre not like 'AUDIT%' and b.nombre not like 'E2E %' and o.created_by is null and not o.historico and ${viejas}`)).toBe("0");
    expect(sql1(`select count(*) from ordenes_compra o where o.created_by is not null and o.historico and ${viejas}`)).toBe("0");
    expect(Number(sql1(`select count(*) from comprobantes where historico`))).toBeGreaterThan(0);
    expect(Number(sql1(`select count(*) from pagos where historico`))).toBeGreaterThan(0);
  });

  test("pago histórico sin voucher: «Histórico · sin archivo», no el simulado", async ({ abrir }) => {
    const fila = sql(`select coalesce(a.obra_id, l.obra_id), coalesce(a.numero_oc, l.numero_oc) from pagos p
                        join pago_aplicaciones a on a.pago_id = p.id left join oc_items l on l.comprobante_id = a.comprobante_id
                       where p.historico and not exists (select 1 from adjuntos v where v.pago_id = p.id) limit 1`)[0];
    test.skip(!fila, "no hay pagos históricos sin voucher");
    const page = await abrir("gerencia", `/consulta/orden/${fila[0]}/${encodeURIComponent(fila[1])}`);
    await expect(page.locator("main")).toContainText("Histórico (Excel)");
    await expect(page.getByText("Histórico · sin archivo").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /simulado/i })).toHaveCount(0);
  });

  test("OS histórica facturada: no espera el contrato firmado (la base la deja ir a Tesorería)", async () => {
    const [obra, numero] = sql(`select obra_id, numero from ordenes_compra where tipo = 'OS' and historico and estado = 'PRECIOS_CONFIRMADOS' order by obra_id, numero limit 1`)[0];
    const uid = uidDe("LOGISTICA");
    const r = sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
      update ordenes_compra set estado = 'FACTURADA' where obra_id = ${obra} and numero = '${numero}';
      set local role authenticated;
      select enviar_si_lista(${obra}, '${numero}');
      rollback;`);
    expect(r.flat()).toContain("t");
  });
});

test.describe("@prod1 hora de Lima", () => {
  test("la base trabaja en America/Lima: «hoy» es el día de Lima", () => {
    expect(sql1("show timezone")).toBe("America/Lima");
    expect(sql1("select current_date = (now() at time zone 'America/Lima')::date")).toBe("t");
  });
});
