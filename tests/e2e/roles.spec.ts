import crypto from "node:crypto";
import fs from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Una persona con varios roles (migración prod1_varios_roles): trabaja con uno a la vez (perfiles.rol) y cambia desde su
// menú entre los suyos (perfil_roles), que asigna solo el Admin. Lo que mira a la persona usa todos sus roles: avisos,
// firmante de una empresa y DNI obligatorio. Corre en el proyecto «flujo», sin nadie más tocando las empresas.

const SB = "http://127.0.0.1:55321";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const SECRETA = env.SUPABASE_SECRET_KEY;
const CLAVE = () => process.env.ERP_PASS!;

async function cuentaTemporal() {
  const clave = crypto.randomUUID().slice(0, 8);
  const email = `e2e-roles-${clave}@erp.local`;
  // Un nombre por cuenta: las pruebas corren a la vez.
  const nombre = `E2E Roles ${clave}`;
  const r = await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const id = ((await r.json()) as { id: string }).id;
  sql(`insert into perfiles (user_id, nombre, rol) values ('${id}', '${nombre}', 'TESORERIA'); select fijar_contrasena('${id}', '${CLAVE()}')`);
  return {
    id,
    email,
    nombre,
    borrar: () => {
      sql(`delete from notificaciones where user_id = '${id}'`);
      sql(`delete from audit_log where (tabla = 'sesion' and detalle->>'email' = '${email}') or user_id = '${id}' or registro like '%${id}%'`);
      sql(`delete from auth.users where id = '${id}'`);
      sql(`delete from audit_log where registro like '%${id}%'`);
    },
  };
}

async function entrar(browser: Browser, info: { project: { use: object } }, email: string) {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(CLAVE());
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { ctx, page };
}

const abrirMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Usuario" }).click();
  return page.getByRole("region", { name: "Rol" });
};

/** Sus roles, y con cuál trabaja. */
const roles = (id: string) => sql(`select rol from perfil_roles where user_id = '${id}' order by rol::text`).map(([r]) => r);
const activo = (id: string) => sql1(`select rol from perfiles where user_id = '${id}'`);

/** Una sentencia con la sesión de la persona, revertida. */
const como = (id: string, sentencia: string, rolDb = "authenticated") =>
  sqlScript(`begin;
    select set_config('request.jwt.claims', '{"sub":"${id}","role":"${rolDb}"}', true) is null;
    set local role ${rolDb};
    ${sentencia};
    rollback;`);

test.describe("@admin @roles varios roles", () => {
  test("el Admin le da un segundo rol y la persona cambia entre ellos; los avisos le llegan por los dos", async ({ abrir, browser }, info) => {
    test.setTimeout(120_000);
    const c = await cuentaTemporal();
    try {
      await test.step("el Admin agrega Gerencia, que pide el DNI", async () => {
        const admin = await abrir("admin", "/admin");
        await admin.getByLabel("Buscar usuario").fill(c.email);
        const fila = admin.locator("main").getByRole("button", { name: new RegExp(c.email.replaceAll(".", "\\.")) });
        await fila.click();
        const ficha = admin.getByRole("dialog", { name: c.nombre });
        await ficha.getByRole("group", { name: "Otros roles" }).getByLabel("Gerencia").check();
        await expect(ficha.getByRole("button", { name: "Guardar" }), "sin DNI").toBeDisabled();
        await ficha.getByLabel(/^DNI/).fill("41234567");
        await ficha.getByRole("button", { name: "Guardar" }).click();
        await expect(ficha).toBeHidden();
        await expect(fila).toContainText("Tesorería · Gerencia");
        expect(roles(c.id)).toEqual(["GERENCIA", "TESORERIA"]);
        expect(activo(c.id), "sigue trabajando como estaba").toBe("TESORERIA");
      });

      const { ctx, page } = await entrar(browser, info, c.email);
      await test.step("entra con su rol y pasa a Gerencia desde el menú", async () => {
        await page.waitForURL(/\/tesoreria/);
        const menu = await abrirMenu(page);
        await expect(menu.getByRole("button", { name: "Tesorería" })).toHaveAttribute("aria-current", "true");
        await menu.getByRole("button", { name: "Gerencia" }).click();
        await page.waitForURL(/\/gerencia\/obras/);
        expect(activo(c.id)).toBe("GERENCIA");
        // El token ya lo tomó: las pantallas son las de Gerencia, también al recargar.
        await page.reload();
        await expect(page).toHaveURL(/\/gerencia\/obras/);
        await abrirMenu(page);
        await expect(page.getByRole("button", { name: "Mi firma" })).toBeVisible();
      });

      await test.step("los avisos de Tesorería le llegan aunque trabaje como Gerencia, y puede elegirlos", async () => {
        sql(`select notificar('TESORERIA', 'E2E_ROLES', 'E2E roles', null, '/tesoreria')`);
        try {
          expect(sql1(`select count(*) from notificaciones where user_id = '${c.id}' and tipo = 'E2E_ROLES'`)).toBe("1");
        } finally {
          sql(`delete from notificaciones where tipo = 'E2E_ROLES'`);
        }
        await page.goto("/avisos");
        await page.getByRole("button", { name: "Elegir avisos" }).click();
        const aviso = page.getByRole("dialog", { name: "Elegir avisos" }).getByRole("listitem", { name: "Llegó una orden por pagar" });
        await expect(aviso.getByRole("switch", { name: "Avisar" }), "es de uno de sus roles: llega por defecto").toHaveAttribute("aria-checked", "true");
      });

      await test.step("una pantalla de su otro rol (un aviso, un link) ofrece cambiar y la abre", async () => {
        await page.goto("/tesoreria?q=e2e");
        await page.waitForURL(/\/rol\?a=TESORERIA/);
        await expect(page.getByRole("heading", { name: "Esta pantalla es de Tesorería" })).toBeVisible();
        expect(activo(c.id), "no cambia sin que lo toque").toBe("GERENCIA");
        await page.getByRole("button", { name: "Cambiar a Tesorería" }).click();
        await page.waitForURL(/\/tesoreria\?q=e2e/);
        expect(activo(c.id)).toBe("TESORERIA");
      });

      await test.step("una pantalla de un rol que no tiene, no", async () => {
        await page.goto("/logistica");
        await page.waitForURL(/\/tesoreria/);
        expect(activo(c.id)).toBe("TESORERIA");
      });

      await test.step("el Admin le quita Gerencia: el menú ya no ofrece cambiar", async () => {
        sql(`delete from perfil_roles where user_id = '${c.id}' and rol = 'GERENCIA'`);
        await page.reload();
        await abrirMenu(page);
        await expect(page.getByRole("button", { name: "Cambiar contraseña" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Rol" })).toHaveCount(0);
      });
      await ctx.close();
    } finally {
      c.borrar();
    }
  });

  test("el Asistente de Contabilidad tiene lo mismo que el Jefe: su módulo, sus permisos y sus avisos", async ({ browser }, info) => {
    const c = await cuentaTemporal();
    try {
      sql(`update perfiles set rol = 'ASISTENTE_CONTABILIDAD' where user_id = '${c.id}'; delete from perfil_roles where user_id = '${c.id}' and rol = 'TESORERIA'`);
      expect(roles(c.id)).toEqual(["ASISTENTE_CONTABILIDAD"]);
      // Para la base es un Jefe de Contabilidad; en perfiles queda su rol.
      expect(como(c.id, `select rol_actual(), rol_en('CONTABILIDAD')`).at(-1)).toEqual(["CONTABILIDAD", "t"]);
      expect(como(c.id, `select exigir_rol('CONTABILIDAD'); select count(*) > 0 from asiento_lineas`).at(-1)).toEqual(["t"]);
      expect(() => como(c.id, `select exigir_rol('TESORERIA')`)).toThrow(/No tienes permiso/);
      // Los avisos de Contabilidad le llegan.
      sql(`select notificar('CONTABILIDAD', 'RECHAZO', 'E2E aviso asistente', null, '/contabilidad/op')`);
      expect(sql1(`select count(*) from notificaciones where user_id = '${c.id}' and titulo = 'E2E aviso asistente'`)).toBe("1");
      sql(`delete from notificaciones where titulo = 'E2E aviso asistente'`);

      const { ctx, page } = await entrar(browser, info, c.email);
      await page.goto("/");
      await page.waitForURL(/\/contabilidad\/compras/);
      await expect(page.getByRole("link", { name: "Cuentas", exact: true })).toBeVisible();
      await page.goto("/tesoreria");
      await expect(page).toHaveURL(/\/contabilidad/);
      await ctx.close();
    } finally {
      c.borrar();
    }
  });

  test("la base: solo pasa a sus roles, nadie se los asigna por la API y cada rol sigue con sus permisos", async () => {
    const c = await cuentaTemporal();
    const otra = await cuentaTemporal();
    try {
      expect(() => como(c.id, `select cambiar_rol('GERENCIA')`), "un rol que no tiene").toThrow(/No tienes ese rol/);
      expect(() => como(c.id, `select cambiar_rol('ADMIN')`)).toThrow(/No tienes ese rol/);
      expect(() => como(c.id, `insert into perfil_roles (user_id, rol) values ('${c.id}', 'ADMIN')`), "asignarse un rol").toThrow(/permission denied/);
      expect(() => como(c.id, `update perfil_roles set rol = 'ADMIN' where user_id = '${c.id}'`)).toThrow(/permission denied/);
      expect(() => como(c.id, `delete from perfil_roles where user_id = '${c.id}'`)).toThrow(/permission denied/);
      expect(() => como(c.id, `select cambiar_rol('TESORERIA')`, "anon"), "sin sesión").toThrow(/permission denied/);
      // Por el perfil tampoco.
      como(c.id, `update perfiles set rol = 'ADMIN' where user_id = '${c.id}'`);
      expect(activo(c.id)).toBe("TESORERIA");

      expect(
        como(c.id, `select count(*) from perfil_roles`).at(-1),
        "cada uno ve solo los suyos",
      ).toEqual(["1"]);

      sql(`insert into perfil_roles (user_id, rol) values ('${c.id}', 'GERENCIA'), ('${c.id}', 'RRHH')`);
      expect(() => como(c.id, `select cambiar_rol('RRHH')`), "un rol sin módulo en prod 1").toThrow(/No tienes ese rol/);
      // Un rol a la vez: como Gerencia no tiene lo de Tesorería, aunque también lo sea.
      expect(como(c.id, `select cambiar_rol('GERENCIA'); select rol_actual()`).at(-1)).toEqual(["GERENCIA"]);
      expect(() => como(c.id, `select cambiar_rol('GERENCIA'); select exigir_rol('TESORERIA')`)).toThrow(/No tienes permiso/);
      expect(como(c.id, `select exigir_rol('TESORERIA'); select rol_actual()`).at(-1), "y como Tesorería sí").toEqual(["TESORERIA"]);

      // El rol con el que trabaja siempre está entre los suyos, aunque se cambie por fuera de la app.
      sql(`update perfiles set rol = 'LOGISTICA' where user_id = '${otra.id}'`);
      expect(roles(otra.id)).toEqual(["LOGISTICA", "TESORERIA"]);
    } finally {
      c.borrar();
      otra.borrar();
    }
  });

  test("firma por una empresa con Gerencia como segundo rol; sin elegir otro firmante no se le puede quitar", async ({ abrir }) => {
    const c = await cuentaTemporal();
    const [id, antes] = sql(`select id, coalesce(firmante_id::text, '') from empresas where nombre = 'ARISANT'`)[0];
    try {
      sql(`insert into perfil_roles (user_id, rol) values ('${c.id}', 'GERENCIA');
           insert into perfil_privado (user_id, dni) values ('${c.id}', '41234567');`);
      const empresas = await abrir("admin", "/admin/empresas");
      await empresas.locator("main li button").filter({ hasText: "ARISANT" }).click();
      const hoja = empresas.getByRole("dialog", { name: "ARISANT" });
      await hoja.getByRole("button", { name: "Firma los contratos", exact: true }).click();
      await empresas.getByRole("listbox", { name: "Firma los contratos" }).getByRole("option").filter({ hasText: c.nombre }).first().click();
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql1(`select firmante_id from empresas where id = ${id}`)).toBe(c.id);

      const admin = await abrir("admin", "/admin");
      await admin.getByLabel("Buscar usuario").fill(c.email);
      await admin.locator("main").getByRole("button", { name: new RegExp(c.email.replaceAll(".", "\\.")) }).click();
      const ficha = admin.getByRole("dialog", { name: c.nombre });
      await ficha.getByRole("group", { name: "Otros roles" }).getByLabel("Gerencia").uncheck();
      await ficha.getByRole("button", { name: "Guardar" }).click();
      await expect(ficha.getByRole("alert")).toHaveText(/Firma por ARISANT/);
      expect(roles(c.id)).toEqual(["GERENCIA", "TESORERIA"]);
    } finally {
      sql(`update empresas set firmante_id = ${antes ? `'${antes}'` : "null"} where id = ${id}`);
      sql(`delete from audit_log where tabla = 'empresas' and registro = '${id}' and created_at > now() - interval '5 minutes'`);
      c.borrar();
    }
  });

  test("el link de bienvenida pide el DNI si Gerencia es uno de sus roles", async () => {
    const c = await cuentaTemporal();
    try {
      sql(`insert into perfil_roles (user_id, rol) values ('${c.id}', 'GERENCIA')`);
      expect(() =>
        sqlScript(`begin;
          insert into invitaciones (user_id, token_hash, expira_at) values ('${c.id}', 'e2e-roles', now() + interval '1 day');
          select bienvenida_completar('e2e-roles', 'Nombre', 'Apellido', '', '', 'Clave12345x');
          rollback;`),
      ).toThrow(/Ingresa tu DNI/);
    } finally {
      c.borrar();
    }
  });

  test("con un solo rol nada cambia: sin opciones en el menú ni pantalla de cambio", async ({ abrir }) => {
    const page = await abrir("logistica", "/rol?a=GERENCIA&volver=/gerencia/obras");
    await page.waitForURL((u) => !u.pathname.startsWith("/rol"));
    await page.goto("/logistica");
    await abrirMenu(page);
    await expect(page.getByRole("button", { name: "Cambiar contraseña" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rol" })).toHaveCount(0);
  });
});
