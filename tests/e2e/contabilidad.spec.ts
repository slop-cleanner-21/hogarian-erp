import type { Locator, Page } from "@playwright/test";
import { SERIE_INVALIDA } from "../../src/lib/serie";
import { expect, test } from "./fixtures";
import { sesion, sql, sql1 } from "./lib";

// Contabilidad: compras (contabilizar, IGV destinado a), TXT SIRE, plan de cuentas, asignar cuentas,
// filtro de pagos y la serie del comprobante en Logística. Cada proyecto (m390/m360) usa sus propios
// datos (`lado`) para correr en paralelo; lo que se escribe se revierte por SQL en la misma prueba.
// Nada de lo que se compara con datos reales (RUC, razón social) se imprime: se comparan booleanos.

const lado = () => (test.info().project.name === "m360" ? 1 : 0);
/** SQL sin dejar rastro en audit_log. */
const sinAuditar = (q: string) => sql(`select set_config('app.skip_audit','on',false); ${q}`);
const ahora = () => sql1("select now()");
const centimos = (s: string) => Number(s.replace(/\D/g, "") || 0);
const hojas = (page: Page) => page.locator("dialog[open]");
/** Espera de lo que pasa por el servidor (acción o navegación): holgada si el servidor está cargado. */
const LENTO = { timeout: 20_000 };
/** Clic que abre una hoja; reintenta si la página todavía no hidrató (el clic no hace nada). */
async function abrirHoja(page: Page, boton: Locator) {
  const antes = await hojas(page).count();
  await expect(async () => {
    if ((await hojas(page).count()) === antes) await boton.click();
    await expect(hojas(page)).toHaveCount(antes + 1, { timeout: 1_500 });
  }).toPass(LENTO);
}
/** Fila de Compras por serie-número exacto. */
const fila = (page: Page, comp: string) =>
  page.locator("main li button").filter({ has: page.locator("span", { hasText: new RegExp(`^${comp}$`) }) });

/** Factura con IGV, sin contabilizar, con todas sus cuentas y serie-número único en su periodo. */
const factura = (empresa: number, extra: string, orden: string) =>
  sql(
    `select r.comprobante_id, r.periodo, r.serie||'-'||r.numero from v_registro_compras r
      where r.empresa_id=${empresa} and r.tipo='FACTURA' and r.igv>0 and r.asiento_id is null
        and coalesce(r.items_sin_cuenta,0)=0 and r.destino_igv='DGNG' ${extra}
        and (select count(*) from v_registro_compras x where x.empresa_id=r.empresa_id and x.periodo=r.periodo
             and x.serie=r.serie and x.numero=r.numero)=1
      order by r.comprobante_id ${orden} offset ${lado()} limit 1`,
  )[0];

test.describe("@contabilidad compras", () => {
  test("contabilizar deja la hoja abierta con el asiento cuadrado e igual a la base", async ({ abrir, revisarPantalla }) => {
    const [cid, periodo, comp] = factura(
      2,
      `and exists (select 1 from v_oc_items_calc i join cuentas_contables c on c.codigo=i.cuenta_contable
                    where i.comprobante_id=r.comprobante_id and c.amarre_debe is not null)`,
      "asc",
    );
    const desde = ahora();
    const page = await abrir("contabilidad", `/contabilidad/compras?empresa=2&periodo=${periodo}`);
    try {
      await abrirHoja(page, fila(page, comp));
      const hoja = hojas(page);
      await hoja.getByRole("button", { name: "Contabilizar", exact: true }).click();
      const origen = hoja.locator("th[scope=colgroup]", { hasText: "Cuentas de origen" });
      await expect(origen).toBeVisible(LENTO);
      await expect(hoja.locator("th[scope=colgroup]", { hasText: "Cuentas de amarre" })).toBeVisible();
      await expect(hojas(page), "la hoja sigue abierta").toHaveCount(1);
      await expect(origen, "baja hasta el asiento").toBeInViewport();
      await revisarPantalla(page);

      const asiento = sql1(`select id from asientos where comprobante_id=${cid} and origen='COMPRA'`);
      expect(asiento, "asiento en la base").not.toBe("");
      const grupos = await hoja.locator("table").last().evaluate((t: HTMLTableElement) =>
        [...t.tBodies].map((b) => {
          const filas = [...b.rows].filter((r) => r.cells.length === 3);
          const celdas = (r: HTMLTableRowElement) => [...r.cells].map((c) => (c as HTMLElement).innerText.trim());
          return {
            titulo: b.querySelector("th")?.textContent ?? "",
            lineas: filas.slice(0, -1).map((r) => [r.cells[0].querySelector("div")?.textContent ?? "", ...celdas(r).slice(1)]),
            subtotal: celdas(filas[filas.length - 1]).slice(1),
          };
        }),
      );
      const bd = sql(
        `select amarre, cuenta, round(debe*100), round(haber*100) from asiento_lineas
          where asiento_id=${asiento} order by orden nulls last, id`,
      );
      for (const [i, g] of grupos.entries()) {
        const amarre = i === 1 ? "t" : "f";
        expect(g.titulo).toBe(i === 1 ? "Cuentas de amarre" : "Cuentas de origen");
        const ui = g.lineas.map(([c, d, h]) => `${c} ${centimos(d)} ${centimos(h)}`);
        const esperado = bd.filter((l) => l[0] === amarre).map(([, c, d, h]) => `${c} ${d} ${h}`);
        expect(ui, `${g.titulo}: líneas iguales a asiento_lineas`).toEqual(esperado);
        const [debe, haber] = g.subtotal.map(centimos);
        expect(debe, `${g.titulo}: Debe = Haber`).toBe(haber);
        expect(debe, `${g.titulo}: subtotal = suma de líneas`).toBe(esperado.reduce((a, l) => a + Number(l.split(" ")[1]), 0));
      }
      expect(grupos).toHaveLength(2);

      // Contabilizada: el selector de IGV queda deshabilitado (y no hay botón Contabilizar).
      await page.keyboard.press("Escape");
      await expect(fila(page, comp)).toContainText("Contabilizado", LENTO);
      await abrirHoja(page, fila(page, comp));
      await expect(hojas(page).getByRole("button", { name: "IGV destinado a", exact: true })).toBeDisabled();
      await expect(hojas(page).getByRole("button", { name: "Contabilizar", exact: true })).toHaveCount(0);
    } finally {
      sinAuditar(
        `delete from audit_log where tabla='asientos' and created_at>='${desde}'
           and registro in (select id::text from asientos where comprobante_id=${cid});
         delete from asientos where comprobante_id=${cid} and origen='COMPRA'`,
      );
    }
  });

  test("IGV destinado a: buscador, DNG y no cierra la hoja", async ({ abrir, revisarPantalla }) => {
    const [cid, periodo, comp] = factura(2, "", "desc");
    const desde = ahora();
    const page = await abrir("contabilidad", `/contabilidad/compras?empresa=2&periodo=${periodo}`);
    try {
      await abrirHoja(page, fila(page, comp));
      const hoja = hojas(page);
      const igv = hoja.getByRole("button", { name: "IGV destinado a", exact: true });
      await expect(igv).toBeEnabled();
      await igv.click();
      const selector = hojas(page).last();
      const buscar = selector.getByRole("searchbox");
      const opciones = selector.getByRole("option");
      await buscar.fill("DGNG");
      await expect(opciones).toHaveCount(1);
      await expect(opciones).toContainText("Operaciones gravadas y no gravadas");
      await buscar.fill("DNG");
      await expect(opciones).toHaveCount(1);
      await expect(opciones).toContainText("Operaciones no gravadas");
      await revisarPantalla(page);
      await opciones.click();
      await expect.poll(() => sql1(`select destino_igv from comprobantes where id=${cid}`), LENTO).toBe("DNG");
      await expect(hojas(page), "la hoja de la factura sigue abierta").toHaveCount(1);
      await expect(hoja.locator("h2")).toContainText(comp);
      await expect(igv).toHaveText("Operaciones no gravadas");
      await expect(hoja.locator("[role=alert]")).toHaveCount(0);
    } finally {
      sinAuditar(
        `update comprobantes set destino_igv='DGNG' where id=${cid};
         delete from audit_log where tabla='comprobantes' and registro='${cid}' and created_at>='${desde}'`,
      );
    }
  });
});

test.describe("@contabilidad SIRE", () => {
  test("TXT del reemplazo: nombre, 41 campos, CRLF, DGNG/DNG y totales", async ({ playwright }) => {
    const periodo = sql1(
      `select periodo from v_registro_compras where empresa_id=1 and tipo='FACTURA' and igv>0 and destino_igv='DGNG'
        group by periodo having count(*)>=2 order by periodo desc offset ${lado()} limit 1`,
    );
    // Una factura pasa a DNG para cubrir las dos ramas (campos 17-18 y 19-20).
    const dng = sql1(
      `select comprobante_id from v_registro_compras where empresa_id=1 and periodo='${periodo}' and tipo='FACTURA'
        and igv>0 and destino_igv='DGNG' order by comprobante_id limit 1`,
    );
    const ctx = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: sesion("contabilidad") });
    try {
      sinAuditar(`update comprobantes set destino_igv='DNG' where id=${dng}`);
      const filas = sql(
        `select comprobante_id, tipo, serie, numero, round(base*100), round(igv*100), round(total*100), destino_igv
           from v_registro_compras where empresa_id=1 and periodo='${periodo}' and tipo in ('FACTURA','BOLETA')
          order by fecha_emision, comprobante_id`,
      );
      const ruc = sql1("select ruc from empresas where id=1");

      const r = await ctx.get(`/contabilidad/ple?empresa=1&periodo=${periodo}`, { maxRedirects: 0 });
      expect(r.status()).toBe(200);
      const nombre = /filename="([^"]+)"/.exec(r.headers()["content-disposition"] ?? "")?.[1] ?? "";
      expect(nombre === `LE${ruc}${periodo}00080400021112.txt`, "nombre del archivo LE+RUC+periodo+0008040002+1+1+12").toBe(true);
      const texto = await r.text();
      expect(texto.endsWith("\n"), "sin salto al final").toBe(false);
      const lineas = texto.split("\r\n");
      expect(texto.split("\n").length, "todos los saltos son CRLF").toBe(lineas.length);
      expect(lineas.length, "una línea por factura/boleta del periodo").toBe(filas.length);

      const errores: string[] = [];
      const mal = (i: number, que: string, ok: boolean) => ok || errores.push(`línea ${i + 1}: ${que}`);
      lineas.forEach((l, i) => {
        const f = l.split("|");
        const [, tipo, serie, numero, base, igv, total, destino] = filas[i];
        const c = (n: number) => Math.round(Number(f[n - 1]) * 100);
        mal(i, "41 campos con «|» final", l.endsWith("|") && f.length === 42);
        mal(i, "periodo (3)", f[2] === periodo);
        mal(i, "tipo (7)", f[6] === (tipo === "FACTURA" ? "01" : "03"));
        mal(i, "serie y número (8, 10)", f[7] === serie && f[9] === numero);
        mal(i, "campo 33 = 1", f[32] === "1");
        const conIgv = tipo === "FACTURA" && Number(igv) > 0;
        const esDng = conIgv && destino === "DNG";
        const esDgng = conIgv && !esDng;
        mal(i, "17-18 DGNG", c(17) === (esDgng ? +base : 0) && c(18) === (esDgng ? +igv : 0));
        mal(i, "19-20 DNG", c(19) === (esDng ? +base : 0) && c(20) === (esDng ? +igv : 0));
        mal(i, "21 no gravadas", c(21) === (conIgv ? 0 : +total));
        mal(i, "25 total", c(25) === +total);
        mal(i, "total = suma 15-24", [15, 16, 17, 18, 19, 20, 21, 22, 23, 24].reduce((a, n) => a + c(n), 0) === c(25));
      });
      expect(errores).toEqual([]);
      expect(filas.some((f) => f[7] === "DNG") && filas.some((f) => f[1] === "FACTURA" && f[7] === "DGNG"), "cubre DGNG y DNG").toBe(true);

      const solo = await ctx.get(`/contabilidad/ple?empresa=1&periodo=${periodo}&ids=${dng}`);
      expect((await solo.text()).split("\r\n"), "ids= filtra a esa factura").toHaveLength(1);
      expect((await ctx.get(`/contabilidad/ple?empresa=1&periodo=${periodo}&ids=abc`)).status(), "ids=abc").toBe(400);
    } finally {
      sinAuditar(`update comprobantes set destino_igv='DGNG' where id=${dng}`);
      await ctx.dispose();
    }
  });
});

test.describe("@contabilidad plan de cuentas", () => {
  test("nueva cuenta: error en el pie, amarre incompleto y amarres con denominación", async ({ abrir, revisarPantalla }) => {
    const codigo = `6599999${lado() + 51}`;
    const [debe, debeNombre] = sql(
      "select codigo, denominacion from cuentas_contables where codigo like '9%' and denominacion<>'Sin denominación' order by codigo limit 1",
    )[0];
    const [haber] = sql("select codigo from cuentas_contables where codigo like '79%' order by codigo limit 1")[0];
    const page = await abrir("contabilidad", "/contabilidad?tab=plan");
    try {
      await abrirHoja(page, page.getByRole("button", { name: "Nueva cuenta" }));
      const hoja = hojas(page);
      const guardar = hoja.locator("footer").getByRole("button", { name: "Guardar" });
      const alerta = hoja.locator("footer [role=alert]");
      await hoja.getByLabel("Denominación").fill("Prueba e2e");
      await hoja.getByLabel("Código").fill("6");
      await guardar.click();
      await expect(alerta).toHaveText("El código tiene de 2 a 12 dígitos", LENTO);
      await hoja.getByLabel("Código").fill(codigo);
      await expect(alerta, "el error se borra al corregir").toHaveCount(0);

      const elegir = async (campo: string, cuenta: string) => {
        await hoja.getByRole("button", { name: campo, exact: true }).click();
        const sel = hojas(page).last();
        await sel.getByRole("searchbox").fill(cuenta);
        await sel.getByRole("option").filter({ hasText: new RegExp(`^${cuenta}\\b`) }).first().click();
        await expect(hojas(page)).toHaveCount(1);
      };
      await elegir("Amarre Debe", debe);
      await expect(hoja.getByText("Falta el amarre de Haber")).toBeVisible();
      await expect(guardar).toBeDisabled();
      await expect(hoja.getByRole("button", { name: "Amarre Debe", exact: true }), "código y denominación").toHaveText(`${debe} ${debeNombre}`);
      await revisarPantalla(page);
      await elegir("Amarre Haber", haber);
      await expect(hoja.getByText(/Falta el amarre de/)).toHaveCount(0);
      await expect(guardar).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(hojas(page)).toHaveCount(0);
      expect(sql1(`select count(*) from cuentas_contables where codigo='${codigo}'`), "no se guardó").toBe("0");
    } finally {
      sql(`delete from cuentas_contables where codigo='${codigo}'`);
    }
  });

  test("asignar cuentas: el selector solo ofrece cuentas de clase 9", async ({ abrir }) => {
    const n9 = Math.min(80, Number(sql1("select count(*) from cuentas_contables where codigo like '9%'")));
    const page = await abrir("contabilidad", "/contabilidad?tab=sin");
    await abrirHoja(page, page.locator("main li button").filter({ hasText: "Asignar" }).first());
    const sel = hojas(page).last();
    const opciones = sel.getByRole("option");
    await expect(opciones).toHaveCount(n9);
    const fuera = (await opciones.allInnerTexts()).filter((t) => !/^9\d+\s/.test(t.trim()));
    expect(fuera, "opciones que no empiezan con 9").toEqual([]);
    await sel.getByRole("searchbox").fill("421210101");
    await expect(opciones).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("@contabilidad pagos", () => {
  test("filtro Empresa: «Todas» es neutra y cada empresa filtra igual que la base", async ({ abrir, revisarPantalla }) => {
    const sinAsiento = "not exists (select 1 from asientos a where a.pago_id=p.id)";
    // Empresas con menos de 100 pagos por contabilizar (la lista muestra 100 por página).
    const candidatas = sql(
      `select e.id, (select count(*) from empresas x where x.nombre < e.nombre) from empresas e
        where (select count(*) from pagos p where p.empresa_id=e.id and ${sinAsiento}) between 1 and 99 order by e.id`,
    );
    const [empresa, pos] = candidatas[lado() % candidatas.length];
    const ops = sql(`select numero_operacion from pagos p where empresa_id=${empresa} and ${sinAsiento}`).map((r) => r[0]);
    const total = Number(sql1(`select count(*) from pagos p where ${sinAsiento}`));
    const nEmpresas = Number(sql1("select count(*) from empresas"));

    const page = await abrir("contabilidad", "/contabilidad/pagos?tab=sin");
    const filas = page.locator("main li button");
    const filtrar = async (opcion: number) => {
      await abrirHoja(page, page.getByRole("button", { name: /^Filtrar y ordenar/ }));
      const hoja = hojas(page);
      await hoja.getByRole("button", { name: "Empresa", exact: true }).click();
      const opciones = hojas(page).last().getByRole("option");
      await expect(opciones).toHaveCount(nEmpresas + 1);
      await expect(opciones.first()).toHaveText("Todas");
      await opciones.nth(opcion).click();
      await hoja.getByRole("button", { name: "Aplicar" }).click();
    };

    await filtrar(Number(pos) + 1);
    await expect(page).toHaveURL(new RegExp(`[?&]empresa=${empresa}(&|$)`), LENTO);
    await expect(filas).toHaveCount(ops.length, LENTO);
    const vistos = (await filas.allInnerTexts()).map((t) => /Op\. (\S+)/.exec(t)?.[1] ?? "");
    expect(vistos.filter((o) => !ops.includes(o)), "pagos de otra empresa").toEqual([]);
    await revisarPantalla(page);

    await filtrar(0);
    await expect(page).not.toHaveURL(/[?&]empresa=/, LENTO);
    await expect(filas).toHaveCount(Math.min(100, total), LENTO);
  });
});

test.describe("@contabilidad órdenes de pago", () => {
  test("Contabilidad crea una OP y la envía; a Tesorería le llega el aviso y la ve en la pestaña OP", async ({ abrir, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const marca = `E2E OP ${Date.now() % 1_000_000}`;
    const [obra] = sql("select nombre from obras where nombre not like 'E2E %' order by id limit 1")[0];
    const [proveedor] = sql("select razon_social from proveedores order by id limit 1")[0];
    let id = "";
    try {
      const page = await abrir("contabilidad", "/contabilidad/op");
      await abrirHoja(page, page.getByRole("button", { name: "Nueva orden de pago" }));
      const hoja = page.getByRole("dialog", { name: "Nueva orden de pago" });
      const crear = hoja.getByRole("button", { name: "Crear OP" });
      await expect(crear).toBeDisabled();
      await expect(hoja.getByText(/^Falta: /)).toBeVisible();
      const elegir = async (campo: string, opcion: string) => {
        await hoja.getByRole("button", { name: campo, exact: true }).click();
        await page.getByRole("searchbox", { name: `Buscar ${campo}` }).fill(opcion);
        await page.getByRole("listbox", { name: campo }).getByRole("option").filter({ hasText: opcion }).first().click();
      };
      await elegir("Obra", obra);
      await elegir("Beneficiario", proveedor);
      await hoja.getByLabel("Concepto").fill(marca);
      await hoja.getByLabel("Monto").fill("123.45");
      await revisarPantalla(page);
      await crear.click();
      await page.waitForURL(/\/contabilidad\/op\/\d+$/, LENTO);
      id = page.url().split("/").pop()!;
      expect(sql1(`select concepto || ' ' || monto || ' ' || estado from ordenes_pago where id = ${id}`)).toBe(`${marca} 123.45 BORRADOR`);

      // Sin cuenta no se envía; con ella, sí.
      const enviar = page.getByRole("button", { name: "Enviar a Tesorería" });
      await expect(enviar).toBeDisabled();
      await expect(page.getByText("Falta: cuenta contable")).toBeVisible();
      await page.getByRole("button", { name: "Cuenta contable", exact: true }).click();
      await page.getByRole("listbox", { name: "Cuenta contable" }).getByRole("option").first().click();
      await expect(enviar).toBeEnabled(LENTO);
      await enviar.click();
      await page.getByRole("button", { name: "Sí", exact: true }).click();
      await expect.poll(() => sql1(`select estado from ordenes_pago where id = ${id}`), LENTO).toBe("EN_TESORERIA");
      const numero = sql1(`select numero from ordenes_pago where id = ${id}`);
      expect(sql1(`select count(*) > 0 from notificaciones n join perfiles p on p.user_id = n.user_id
                   where p.rol = 'TESORERIA' and n.titulo like 'Nueva ${numero} por pagar%' and n.href = '/tesoreria/pago/op/${id}'`)).toBe("t");

      const teso = await abrir("tesoreria", "/tesoreria?empresa=todas&doc=OP");
      await expect(teso.getByRole("tab", { name: "OP", exact: true })).toHaveAttribute("aria-selected", "true");
      const fila = teso.locator(`main a[href="/tesoreria/pago/op/${id}"]`);
      await expect(fila.first()).toBeVisible(LENTO);
      await fila.first().click();
      await teso.waitForURL(new RegExp(`/tesoreria/pago/op/${id}$`), LENTO);
      await expect(teso.getByText(marca)).toBeVisible();
    } finally {
      if (id) sinAuditar(`delete from notificaciones where href = '/tesoreria/pago/op/${id}'; delete from ordenes_pago where id = ${id}`);
    }
  });
});

test.describe("@contabilidad cuántos hay en cada pestaña", () => {
  test("OP: Borrador / Tesorería / Pagadas / Anuladas; Impuestos: detracciones y meses de retenciones por pagar", async ({ abrir }) => {
    const circulo = (page: import("@playwright/test").Page, pestana: string) => page.getByRole("tab", { name: pestana, exact: true }).locator("[data-cuenta]");
    const revisar = async (page: import("@playwright/test").Page, esperado: [string, number][]) => {
      for (const [pestana, n] of esperado) {
        if (n) await expect(circulo(page, pestana), pestana).toHaveAttribute("data-cuenta", String(n));
        else await expect(circulo(page, pestana), pestana).toHaveCount(0);
      }
    };
    const op = (estado: string) => Number(sql1(`select count(*) from ordenes_pago where estado = '${estado}'`));
    const page = await abrir("contabilidad", "/contabilidad/op?est=bor");
    await revisar(page, [["Borrador", op("BORRADOR")], ["Tesorería", op("EN_TESORERIA")], ["Pagadas", op("PAGADA")], ["Anuladas", op("ANULADA")]]);

    const det = Number(sql1("select count(*) from v_detracciones where impuesto_pago_id is null"));
    const ret = Number(sql1("select count(distinct (empresa_id, periodo)) from v_retenciones_4ta where impuesto_pago_id is null"));
    const imp = await abrir("contabilidad", "/contabilidad/impuestos?imp=det&est=pend");
    await revisar(imp, [["Detracciones", det], ["Retenciones 4ta", ret], ["Por pagar", det]]);
  });
});
