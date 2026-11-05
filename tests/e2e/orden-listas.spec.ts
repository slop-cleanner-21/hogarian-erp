import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql } from "./lib";

// Ordenar y filtrar con listas de más de 100 (la página trae 100 y, al llegar al fondo, se suman otras 100): cada opción de «Ordenar
// por» da las mismas filas y en el mismo orden que la base, en la primera página y al ampliar; con filtros, también.
// Solo órdenes de hace más de una semana: las que crean otras pruebas en paralelo (de hoy) no cambian el resultado.

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
const HASTA = hace(7);
const RANGO = `2000-01-01_${HASTA}`;
/** Para la base: hasta HASTA inclusive. */
const enRango = `fecha >= '2000-01-01' and fecha < '${HASTA}'::date + 1`;

/** Las filas de la lista: «obra/N°» sacado del enlace de cada una. */
async function filas(page: Page, prefijo: string) {
  const hrefs = await page.locator(`main a[href^='${prefijo}']`).evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((h) => {
    const [obra, numero] = h.split("?")[0].slice(prefijo.length).split("/");
    return `${obra}/${decodeURIComponent(numero)}`;
  });
}
const claves = (consulta: string) => sql(consulta).map(([k]) => k);

/** «Ver más» es continuo: al llegar al fondo de la lista se piden 100 más. */
const alFondo = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

/** Cómo ordena la base cada opción (con el mismo desempate que la app). */
const dir = (asc: boolean) => (asc ? "asc nulls last" : "desc nulls last");

test.describe("@listas ordenar y filtrar con más de 100", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("Logística › OC (Todas): cada orden da lo mismo que la base, con «Ver más»", async ({ abrir }) => {
    const total = Number(sql(`select count(*) from v_ordenes where tipo = 'OC' and ${enRango}`)[0][0]);
    expect(total, "hacen falta más de 100 órdenes para la prueba").toBeGreaterThan(100);
    const page = await abrir("logistica", "/logistica?tipo=OC&tab=todas");
    await page.context().addCookies([{ name: "prod1_diseno_logistica", value: "lista", url: new URL(page.url()).origin }]);
    for (const [orden, col, asc] of [
      ["fecha.desc", "fecha", false],
      ["fecha.asc", "fecha", true],
      ["total.desc", "total", false],
      ["total.asc", "total", true],
      ["numero.desc", "numero", false],
      ["numero.asc", "numero", true],
      ["proveedor.asc", "proveedor", true],
    ] as const) {
      const base = (n: number) =>
        claves(`select obra_id || '/' || numero from v_ordenes where tipo = 'OC' and ${enRango}
                order by ${col} ${dir(asc)}, created_at desc, obra_id, numero limit ${n}`);
      await page.goto(`/logistica?tipo=OC&tab=todas&fecha=${RANGO}&orden=${orden}`);
      await expect.poll(() => filas(page, "/logistica/ordenes/"), { message: orden }).toEqual(base(100));
      // «Ver más»: las 100 de antes, en el mismo lugar, y las 100 siguientes.
      await expect.poll(async () => (await alFondo(page), filas(page, "/logistica/ordenes/")), { message: `${orden}, ver más` }).toEqual(base(200));
    }
  });

  test("Logística: pestañas y filtros con más de 100 dan las mismas filas que la base", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica?tipo=OC&tab=todas");
    await page.context().addCookies([{ name: "prod1_diseno_logistica", value: "lista", url: new URL(page.url()).origin }]);
    const orden = "order by fecha desc nulls last, created_at desc, obra_id, numero";
    const [e1] = sql(`select e from (select unnest(etapas) e, count(*) n from v_ordenes where tipo = 'OC' and ${enRango} group by 1) x order by n desc limit 1`)[0];
    for (const [url, filtro] of [
      ["tab=rec", "estado = 'RECIBIDA'"],
      ["tab=todas&estado=PRECIOS_CONFIRMADOS", "estado = 'PRECIOS_CONFIRMADOS'"],
      [`tab=todas&etapa=${encodeURIComponent(e1)}`, `etapas && array['${e1}']`],
      ["tab=todas&monto=medio", "total >= 1000 and total < 10000"],
    ] as const) {
      const base = claves(`select obra_id || '/' || numero from v_ordenes where tipo = 'OC' and ${enRango} and ${filtro} ${orden} limit 200`);
      await page.goto(`/logistica?tipo=OC&fecha=${RANGO}&n=200&${url}`);
      await expect.poll(() => filas(page, "/logistica/ordenes/"), { message: url }).toEqual(base);
    }
  });

  test("Tesorería › Pagos (Pagadas): cada orden da lo mismo que la base, con «Ver más»", async ({ abrir }) => {
    const total = Number(sql(`select count(*) from v_por_pagar where estado = 'PAGADO' and doc = 'OC' and ${enRango}`)[0][0]);
    expect(total, "hacen falta más de 100 pagadas para la prueba").toBeGreaterThan(100);
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
    await page.context().addCookies([{ name: "prod1_diseno_pagos", value: "lista", url: new URL(page.url()).origin }]);
    for (const [orden, col, asc] of [
      ["fecha.desc", "fecha", false],
      ["fecha.asc", "fecha", true],
      ["monto.desc", "pagado", false],
      ["monto.asc", "pagado", true],
      ["proveedor.asc", "proveedor", true],
      ["numero.asc", "numero", true],
    ] as const) {
      const base = (n: number) =>
        claves(`select obra_id || '/' || numero from v_por_pagar where estado = 'PAGADO' and doc = 'OC' and ${enRango}
                order by ${col} ${dir(asc)}, numero, obra_id limit ${n}`);
      await page.goto(`/tesoreria?empresa=todas&area=log&est=pag&doc=OC&fecha=${RANGO}&orden=${orden}`);
      await expect.poll(() => filas(page, "/tesoreria/pago/"), { message: orden }).toEqual(base(100));
      await expect.poll(async () => (await alFondo(page), filas(page, "/tesoreria/pago/")), { message: `${orden}, ver más` }).toEqual(base(200));
    }
  });

  test("Gerencia › Órdenes: cada orden y los filtros dan lo mismo que la base, con «Ver más»", async ({ abrir }) => {
    // Gerencia no filtra por fecha: una obra del Excel con más de 100 órdenes.
    const [obra] = sql(`select obra_id from v_ordenes group by 1 having count(*) > 100 and max(fecha) < '${HASTA}' order by count(*) desc limit 1`)[0] ?? [];
    test.skip(!obra, "sin una obra con más de 100 órdenes");
    const page = await abrir("gerencia", `/gerencia/ordenes?obra=${obra}`);
    for (const [orden, col, asc] of [
      ["fecha.desc", "fecha", false],
      ["fecha.asc", "fecha", true],
      ["total.desc", "total", false],
      ["total.asc", "total", true],
    ] as const) {
      const base = (n: number, filtro = "") =>
        claves(`select obra_id || '/' || numero from v_ordenes where obra_id = ${obra} ${filtro}
                order by ${col} ${dir(asc)}, numero, obra_id limit ${n}`);
      await page.goto(`/gerencia/ordenes?obra=${obra}&orden=${orden}`);
      await expect.poll(() => filas(page, "/consulta/orden/"), { message: orden }).toEqual(base(100));
      await expect.poll(async () => (await alFondo(page), filas(page, "/consulta/orden/")), { message: `${orden}, ver más` }).toEqual(base(200));
      // Con el filtro de tipo.
      await page.goto(`/gerencia/ordenes?obra=${obra}&orden=${orden}&tipo=OC&n=200`);
      await expect.poll(() => filas(page, "/consulta/orden/"), { message: `${orden}, OC` }).toEqual(base(200, "and tipo = 'OC'"));
    }
  });
});
