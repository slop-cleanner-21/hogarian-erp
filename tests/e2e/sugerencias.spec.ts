import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { ROLES, sesionApi, sql, sql1, sqlScript, uidDe, type Rol } from "./lib";

// Sugerencias: desde el encabezado de cualquier pantalla, con capturas y la pantalla de origen. Le llegan al Admin.

const SB = "http://127.0.0.1:55321";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRETA = env.SUPABASE_SECRET_KEY;
const ARCHIVO = path.resolve("tests/e2e/archivos/ariant.png");

const limpiar = (marca: string) => {
  const capturas = sql(`select unnest(capturas) from sugerencias where texto like '%${marca}%'`).map(([c]) => c);
  if (capturas.length) void fetch(`${SB}/storage/v1/object/sugerencias`, { method: "DELETE", headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: capturas }) });
  sql(`delete from notificaciones where tipo = 'SUGERENCIA' and cuerpo like '%${marca}%'`);
  sql(`delete from audit_log where tabla = 'sugerencias' and detalle::text like '%${marca}%'`);
  sql(`delete from sugerencias where texto like '%${marca}%'`);
};

test.describe("@sugerencias sugerencias", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
  });

  test("todos los roles tienen el botón, también en las pantallas sin menú de usuario", async ({ abrir }) => {
    const pantallas: [Rol, string][] = [
      ["logistica", "/logistica"],
      ["logistica", "/logistica/ordenes/nueva?tipo=OC"],
      ["tesoreria", "/tesoreria"],
      ["gerencia", "/gerencia/obras"],
      ["jefe", "/operaciones"],
      ["operaciones", "/operaciones"],
      ["admin", "/admin"],
    ];
    for (const [rol, ruta] of pantallas) {
      const page = await abrir(rol, ruta);
      await expect(page.getByRole("button", { name: "Sugerencias" }), `${rol} ${ruta}`).toBeVisible();
    }
  });

  test("Logística manda un error con captura y la pantalla; el Admin recibe el aviso y lo ve; nadie más", async ({ abrir }) => {
    const marca = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const page = await abrir("logistica", "/logistica/proveedores?q=x");
      await page.getByRole("button", { name: "Sugerencias" }).click();
      const hoja = page.getByRole("dialog", { name: "Sugerencia" });
      await expect(hoja.getByRole("button", { name: "Enviar" }), "sin detalle").toBeDisabled();
      await expect(hoja.getByRole("radio", { name: "Error" })).toHaveAttribute("aria-checked", "true");
      await hoja.getByRole("radio", { name: "Diseño" }).click();
      await hoja.getByLabel("Detalle").fill(`El botón se ve chico ${marca}`);
      await hoja.getByLabel("Capturas").setInputFiles(ARCHIVO);
      await expect(hoja.getByRole("img", { name: "Captura 1" })).toBeVisible();
      await expect(hoja).toContainText("Desde: Proveedores");
      await hoja.getByRole("button", { name: "Enviar" }).click();
      await expect(hoja.getByRole("status")).toContainText("Ya le llegó al administrador");

      const [uid, rol, tipo, pantalla, ruta, n] = sql(`select user_id, rol, tipo, pantalla, ruta, cardinality(capturas) from sugerencias where texto like '%${marca}%'`)[0];
      expect([uid, rol, tipo, pantalla, ruta, n]).toEqual([uidDe("LOGISTICA"), "LOGISTICA", "DISENO", "Proveedores", "/logistica/proveedores?q=x", "1"]);
      expect(sql1(`select count(*) from notificaciones where tipo = 'SUGERENCIA' and cuerpo like '%${marca}%' and user_id = '${uidDe("ADMIN")}'`), "aviso al Admin").toBe("1");
      expect(sql1(`select count(*) from notificaciones where tipo = 'SUGERENCIA' and cuerpo like '%${marca}%' and user_id = '${uidDe("LOGISTICA")}'`), "a nadie más").toBe("0");

      const admin = await abrir("admin", "/admin/sugerencias");
      const item = admin.locator("main li").filter({ hasText: marca });
      await expect(item).toContainText("Preferencia de diseño");
      await expect(item).toContainText("Logística");
      const imagen = item.getByRole("img", { name: "captura 1" });
      await expect(imagen).toBeVisible();
      await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      await expect(item.getByRole("link", { name: "Proveedores" })).toHaveAttribute("href", "/logistica/proveedores?q=x");

      // Otro rol no entra.
      const tes = await abrir("tesoreria", "/tesoreria");
      await tes.goto("/admin/sugerencias");
      await expect(tes).not.toHaveURL(/\/admin\/sugerencias/);
    } finally {
      limpiar(marca);
    }
  });

  test("la base: nadie lee las sugerencias ni las capturas de otro; solo se usan archivos propios", async () => {
    const marca = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    const s = await sesionApi(SB, ANON, SECRETA, ROLES.logistica);
    const h = { apikey: ANON, Authorization: `Bearer ${s.access_token}` };
    const como = (uid: string, sentencia: string) =>
      sqlScript(`begin;
        select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
        set local role authenticated;
        ${sentencia};
        rollback;`);
    const log = uidDe("LOGISTICA");

    expect((await fetch(`${SB}/rest/v1/sugerencias?select=id`, { headers: h })).status, "leer por la API").toBeGreaterThanOrEqual(400);
    expect(() => como(log, `insert into sugerencias (rol, tipo, texto) values ('X', 'ERROR', 'hola')`), "escribir directo").toThrow(/permission denied/);
    expect(() => como(log, `select enviar_sugerencia('OTRO', 'hola mundo', null, null, null)`)).toThrow(/Elige el tipo/);
    expect(() => como(log, `select enviar_sugerencia('ERROR', 'x', null, null, null)`)).toThrow(/Cuéntanos/);
    expect(() => como(log, `select enviar_sugerencia('ERROR', 'hola mundo', null, null, array['${uidDe("TESORERIA")}/x.png'])`), "archivo ajeno").toThrow(/Captura no válida/);
    expect(() => como(log, `select enviar_sugerencia('ERROR', 'hola mundo', null, null, array['${log}/../x.png'])`)).toThrow(/Captura no válida/);
    expect(() => como(log, `select enviar_sugerencia('ERROR', 'hola mundo', null, null, array['${log}/no-existe.png'])`), "sin subir").toThrow(/Captura no válida/);
    expect(() => como(uidDe("CONTABILIDAD"), `select enviar_sugerencia('ERROR', 'hola mundo', null, null, null)`), "rol sin módulo").toThrow(/No tienes permiso/);
    expect(como(uidDe("JEFE_OPERACIONES"), `select enviar_sugerencia('MEJORA', 'hola ${marca}', 'Seguimiento', '/operaciones', null) > 0`).at(-1), "el Jefe sí puede").toEqual(["t"]);

    // Las capturas: cada uno a su carpeta, y nadie las lee por la API.
    const ruta = `${s.user.id}/${marca}.png`;
    const png = fs.readFileSync(ARCHIVO);
    const subir = (r: string) => fetch(`${SB}/storage/v1/object/sugerencias/${r}`, { method: "POST", headers: { ...h, "Content-Type": "image/png" }, body: png });
    try {
      expect((await subir(ruta)).status, "a su carpeta").toBe(200);
      expect((await subir(`${uidDe("TESORERIA")}/${marca}.png`)).status, "a la de otro").toBeGreaterThanOrEqual(400);
      expect((await fetch(`${SB}/storage/v1/object/authenticated/sugerencias/${ruta}`, { headers: h })).status, "bajarla por la API").toBeGreaterThanOrEqual(400);
    } finally {
      await fetch(`${SB}/storage/v1/object/sugerencias`, { method: "DELETE", headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [ruta] }) });
    }
  });
});
