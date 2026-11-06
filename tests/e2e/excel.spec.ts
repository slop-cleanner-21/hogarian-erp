import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "./fixtures";
import { EN_PROD, ROLES, sql, sql1 } from "./lib";

// Exportar el Excel de control de costos: el mismo .xlsm (plantilla en el bucket privado «excel»), con lo que se registró
// en la app escrito en sus celdas de datos. Se comprueba leyéndolo con el mismo extractor con el que se cargó: lo que la
// app tiene debe volver a salir del Excel. Corre en el proyecto «flujo»: compara contra toda la base.

const hayPlantilla = () => sql1(`select count(*) from storage.objects where bucket_id = 'excel' and name = 'plantilla.xlsm'`) === "1";

async function exportar(page: Page, destino: string) {
  await page.getByRole("button", { name: "Usuario" }).click();
  const [descarga] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: "Exportar Excel" }).click(),
  ]);
  expect(descarga.suggestedFilename()).toMatch(/^CONTROL DE COSTOS \d{4}-\d{2}-\d{2}\.xlsm$/);
  await descarga.saveAs(destino);
}

/** El extractor del Excel sobre lo exportado: su resumen y el SQL que generaría. */
function extraer(xlsm: string) {
  const salida = xlsm.replace(/\.xlsm$/, ".sql");
  const resumen = execFileSync("python", ["-I", "scripts/extract_excel.py", xlsm, salida], { encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  return { resumen, sql: fs.readFileSync(salida, "utf8") };
}
const cuenta = (resumen: string, re: RegExp) => Number(re.exec(resumen)?.[1]);

test.describe("@excel exportar el Excel", () => {
  test("sale el mismo libro con todo lo de la app: órdenes nuevas, comprobantes y pagos", async ({ abrir }) => {
    test.setTimeout(240_000);
    test.skip(!hayPlantilla(), "sin plantilla: npm run excel:plantilla");
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "erp-excel-"));
    const xlsm = path.join(carpeta, "exportado.xlsm");
    try {
      const page = await abrir("logistica", "/logistica");
      await exportar(page, xlsm);

      const archivos = unzipSync(fs.readFileSync(xlsm));
      expect(Object.keys(archivos), "macros").toContain("xl/vbaProject.bin");
      expect(Object.keys(archivos), "la cadena de cálculo se rearma al abrir").not.toContain("xl/calcChain.xml");
      expect(strFromU8(archivos["xl/workbook.xml"]), "recalcula al abrir").toContain('fullCalcOnLoad="1"');
      expect(strFromU8(archivos["[Content_Types].xml"])).not.toContain("calcChain");
      expect(strFromU8(archivos["xl/_rels/workbook.xml.rels"])).not.toContain("calcChain");
      // Las fórmulas siguen: la hoja de compras tiene las mismas que traía.
      expect((strFromU8(archivos["xl/worksheets/sheet6.xml"]).match(/<f[ >]/g) ?? []).length).toBeGreaterThan(250_000);

      const { resumen, sql: extraido } = extraer(xlsm);
      // Lo que tiene la app, salvo lo que no es una compra todavía (sin precios) o ya no (anulada).
      const fuera = `(o.estado = 'ANULADA' or (not o.historico and o.estado = 'EMITIDA'))`;
      const lineas = Number(sql1(`select count(*) from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc where not ${fuera}`));
      expect(cuenta(resumen, /oc_items (\d+)/), "líneas").toBe(lineas);
      expect(cuenta(resumen, /^partidas (\d+)/m), "partidas").toBe(Number(sql1(`select count(*) from partidas`)));
      expect(cuenta(resumen, /proveedores (\d+)/), "proveedores").toBe(Number(sql1(`select count(*) from proveedores`)));
      expect(cuenta(resumen, /obras (\d+)/), "obras").toBe(Number(sql1(`select count(*) from obras`)));
      expect(cuenta(resumen, /^items (\d+)/m), "ítems").toBe(Number(sql1(`select count(*) from items`)));

      // Una orden hecha en la app, con su comprobante y su pago, vuelve a salir del Excel.
      const fila = sql(
        `select o.numero, c.serie, c.numero, p.numero_operacion from ordenes_compra o
           join oc_items l on l.obra_id = o.obra_id and l.numero_oc = o.numero
           join comprobantes c on c.id = l.comprobante_id and not c.historico
           join pago_aplicaciones a on a.comprobante_id = c.id join pagos p on p.id = a.pago_id and not p.historico
          where not o.historico and o.estado <> 'ANULADA' order by o.obra_id, o.numero limit 1`,
      )[0];
      if (fila) {
        const [numero, serie, comp, operacion] = fila;
        expect(extraido, "orden").toContain(`'${numero}'`);
        expect(extraido, "comprobante").toContain(`'${serie}', '${comp}'`);
        expect(extraido, "operación").toContain(`'${operacion}'`);
      }
      const nuevas = Number(sql1(`select count(*) from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc where not o.historico and not ${fuera}`));
      // En producción el recorrido ya limpió lo suyo: puede no haber ninguna.
      if (!EN_PROD) expect(nuevas, "hay órdenes de la app para exportar").toBeGreaterThan(0);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
      sql(`delete from audit_log where accion = 'EXPORTAR_EXCEL' and user_id in (select id from auth.users where email in ('${ROLES.logistica}', '${ROLES.gerencia}'))`);
    }
  });

  test("se baja aunque el navegador tenga muchas cookies (en localhost llegan también las del MVP)", async ({ abrir }, info) => {
    test.setTimeout(120_000);
    test.skip(!hayPlantilla(), "sin plantilla: npm run excel:plantilla");
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "erp-excel-"));
    try {
      const page = await abrir("gerencia", "/gerencia/obras");
      // Más de los 8 KB que acepta la puerta de entrada de Supabase.
      await page.context().addCookies(
        [0, 1, 2].map((i) => ({ name: `e2e_grande_${i}`, value: "x".repeat(3500), url: info.project.use.baseURL ?? "http://localhost:3100" })),
      );
      await page.reload();
      await exportar(page, path.join(carpeta, "exportado.xlsm"));
      expect(fs.statSync(path.join(carpeta, "exportado.xlsm")).size).toBeGreaterThan(1_000_000);
    } finally {
      fs.rmSync(carpeta, { recursive: true, force: true });
      sql(`delete from audit_log where accion = 'EXPORTAR_EXCEL' and user_id in (select id from auth.users where email in ('${ROLES.logistica}', '${ROLES.gerencia}'))`);
    }
  });

  test("Tesorería y Gerencia también lo tienen; el Jefe de Operaciones no", async ({ abrir }) => {
    for (const [rol, ruta] of [["tesoreria", "/tesoreria"], ["gerencia", "/gerencia/obras"]] as const) {
      const page = await abrir(rol, ruta);
      await page.getByRole("button", { name: "Usuario" }).click();
      await expect(page.getByRole("button", { name: "Exportar Excel" }), rol).toBeVisible();
    }
    const jefe = await abrir("jefe", "/operaciones");
    await jefe.getByRole("button", { name: "Usuario" }).click();
    await expect(jefe.getByRole("button", { name: "Cambiar contraseña" })).toBeVisible();
    await expect(jefe.getByRole("button", { name: "Exportar Excel" })).toHaveCount(0);
  });

  test("la plantilla y lo exportado no se leen desde afuera: solo el servidor", () => {
    expect(sql1(`select public from storage.buckets where id = 'excel'`)).toBe("f");
    expect(sql1(`select count(*) from pg_policies where schemaname = 'storage' and (qual like '%''excel''%' or with_check like '%''excel''%')`)).toBe("0");
  });
});
