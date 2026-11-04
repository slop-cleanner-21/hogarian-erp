import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Gestión de usuarios del Admin: crear la cuenta, restablecer la contraseña, cambiar el rol, desactivar
// y reactivar; y cada usuario cambia su contraseña. La cuenta de prueba se borra al final.

/** Entra con correo y contraseña en un navegador nuevo; devuelve la página o el error del login. */
async function entrar(browser: Browser, baseURL: string, email: string, pass: string): Promise<{ page: Page; error: string | null }> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(pass);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  // Solo el aviso del formulario (Next tiene otro role="alert", vacío, para anunciar las rutas).
  const error = page.locator("main [role=alert], form [role=alert]").filter({ hasText: /\S/ });
  await Promise.race([page.waitForURL((u) => !u.pathname.startsWith("/login")), error.first().waitFor()]);
  return { page, error: page.url().includes("/login") ? await error.first().innerText() : null };
}

const base = (info: { project: { use: { baseURL?: string } } }) => info.project.use.baseURL!;

const borrar = (email: string) =>
  sqlScript(`delete from public.perfiles where user_id in (select id from auth.users where email = '${email}');
             delete from auth.users where email = '${email}';`);

test.describe("@prod1 @admin usuarios", () => {
  test("solo el Admin entra a Usuarios", async ({ abrir }) => {
    const page = await abrir("logistica", "/admin");
    expect(new URL(page.url()).pathname).not.toBe("/admin");
    const admin = await abrir("admin", "/admin");
    await expect(admin.locator("main")).toContainText("gerencia@erp.local");
    await expect(admin.locator("main")).toContainText("Jefe de Operaciones");
  });

  test("crear, entrar, cambiar su contraseña, restablecerla, cambiar el rol, desactivar y reactivar", async ({ abrir, browser, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    test.setTimeout(120_000);
    const base = info.project.use.baseURL!;
    const email = `e2e-usuario-${Date.now()}@erp.local`;
    try {
      const admin = await abrir("admin", "/admin");
      await revisarPantalla(admin);
      await admin.getByRole("button", { name: "Nuevo usuario" }).click();
      const hoja = admin.getByRole("dialog", { name: "Nuevo usuario" });
      await hoja.getByLabel("Nombre").fill("Prueba E2E");
      await hoja.getByLabel("Correo").fill(email);
      await hoja.getByRole("button", { name: "Rol", exact: true }).click();
      await admin.getByRole("listbox", { name: "Rol" }).getByRole("option", { name: "Tesorería", exact: true }).click();
      const temporal = await hoja.getByLabel("Contraseña", { exact: true }).inputValue();
      expect(temporal.length).toBeGreaterThanOrEqual(8);
      await hoja.getByRole("button", { name: "Crear cuenta" }).click();
      const creada = admin.getByRole("dialog", { name: "Cuenta creada" });
      await expect(creada.getByRole("region", { name: "Credenciales" })).toContainText(temporal);
      expect(sql(`select p.rol, p.nombre, u.email_confirmed_at is not null from perfiles p join auth.users u on u.id = p.user_id where u.email = '${email}'`)).toEqual([["TESORERIA", "Prueba E2E", "t"]]);
      await creada.getByRole("button", { name: "Listo" }).click();
      await expect(admin.locator("main")).toContainText(email);

      // Entra con la temporal y la cambia desde su menú.
      const u = await entrar(browser, base, email, temporal);
      expect(u.error).toBeNull();
      await u.page.waitForURL((x) => x.pathname.startsWith("/tesoreria"));
      await u.page.getByRole("button", { name: "Usuario" }).click();
      await u.page.getByRole("button", { name: "Cambiar contraseña" }).click();
      const cambio = u.page.getByRole("dialog", { name: "Cambiar contraseña" });
      await cambio.getByLabel(/^Nueva contraseña/).fill("propia-e2e-123");
      await cambio.getByLabel("Repetir la contraseña").fill("propia-e2e-123");
      await cambio.getByRole("button", { name: "Cambiar contraseña" }).click();
      await expect(u.page.getByRole("dialog", { name: "Contraseña cambiada" })).toBeVisible();
      expect((await entrar(browser, base, email, temporal)).error).toMatch(/incorrectos/);
      expect((await entrar(browser, base, email, "propia-e2e-123")).error).toBeNull();

      // El Admin la restablece: sirve la nueva, no la anterior.
      await admin.locator("main").getByRole("button", { name: new RegExp(email) }).click();
      const ficha = admin.getByRole("dialog", { name: "Prueba E2E", exact: true });
      await ficha.getByRole("button", { name: "Restablecer contraseña" }).click();
      await admin.getByRole("dialog").filter({ hasText: "¿Restablecer la contraseña?" }).getByRole("button", { name: /^Sí/ }).click();
      const credenciales = ficha.getByRole("region", { name: "Credenciales" });
      await expect(credenciales).toBeVisible();
      const nueva = (await credenciales.innerText()).split("\n").filter(Boolean).pop()!.trim();
      expect(nueva.length).toBeGreaterThanOrEqual(8);
      expect((await entrar(browser, base, email, "propia-e2e-123")).error).toMatch(/incorrectos/);
      expect((await entrar(browser, base, email, nueva)).error).toBeNull();

      // Cambia el rol.
      await ficha.getByRole("button", { name: "Rol", exact: true }).click();
      await admin.getByRole("listbox", { name: "Rol" }).getByRole("option", { name: "Logística", exact: true }).click();
      await ficha.getByRole("button", { name: "Guardar" }).click();
      await expect(ficha).toBeHidden();
      expect(sql1(`select p.rol from perfiles p join auth.users u on u.id = p.user_id where u.email = '${email}'`)).toBe("LOGISTICA");
      expect(sql1(`select raw_app_meta_data->>'rol' from auth.users where email = '${email}'`)).toBe("LOGISTICA");

      // Desactivada: no entra y la base no le da datos aunque tenga un token vigente.
      await admin.locator("main").getByRole("button", { name: new RegExp(email) }).click();
      await ficha.getByRole("button", { name: "Desactivar cuenta" }).click();
      await admin.getByRole("dialog").filter({ hasText: "¿Desactivar" }).getByRole("button", { name: /^Sí/ }).click();
      await expect(ficha).toBeHidden();
      await expect(admin.locator("main").getByRole("button", { name: new RegExp(email) })).toContainText("Desactivado");
      expect((await entrar(browser, base, email, nueva)).error).toMatch(/incorrectos/);
      const id = sql1(`select id from auth.users where email = '${email}'`);
      const comoUsuario = (consulta: string) =>
        sqlScript(`begin; set local role authenticated; set local request.jwt.claims = '{"sub":"${id}","role":"authenticated"}';
                   ${consulta}; rollback;`)[0]?.[0];
      expect(comoUsuario("select '[' || rol_actual() || ']'")).toBe("[]");
      expect(comoUsuario("select count(*) from ordenes_compra")).toBe("0");

      // Reactivada: vuelve a entrar.
      await admin.locator("main").getByRole("button", { name: new RegExp(email) }).click();
      await ficha.getByRole("button", { name: "Reactivar cuenta" }).click();
      await admin.getByRole("dialog").filter({ hasText: "¿Reactivar" }).getByRole("button", { name: /^Sí/ }).click();
      await expect(ficha).toBeHidden();
      expect((await entrar(browser, base, email, nueva)).error).toBeNull();
      expect(comoUsuario("select rol_actual()")).toBe("LOGISTICA");
    } finally {
      borrar(email);
    }
  });

  test("una cuenta sin perfil va a «Sin acceso» (no entra como Logística)", async ({ abrir, browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const email = `e2e-sinperfil-${Date.now()}@erp.local`;
    try {
      const admin = await abrir("admin", "/admin");
      await admin.getByRole("button", { name: "Nuevo usuario" }).click();
      const hoja = admin.getByRole("dialog", { name: "Nuevo usuario" });
      await hoja.getByLabel("Nombre").fill("Sin Perfil E2E");
      await hoja.getByLabel("Correo").fill(email);
      await hoja.getByRole("button", { name: "Rol", exact: true }).click();
      await admin.getByRole("listbox", { name: "Rol" }).getByRole("option", { name: "Logística", exact: true }).click();
      const clave = await hoja.getByLabel("Contraseña", { exact: true }).inputValue();
      await hoja.getByRole("button", { name: "Crear cuenta" }).click();
      await expect(admin.getByRole("dialog", { name: "Cuenta creada" })).toBeVisible();
      // Sin perfil (y sin rol en el token).
      sqlScript(`update auth.users set raw_app_meta_data = raw_app_meta_data - 'rol' - 'nombre' where email = '${email}';
                 delete from public.perfiles where user_id = (select id from auth.users where email = '${email}');`);
      const u = await entrar(browser, base(info), email, clave);
      expect(u.error).toBeNull();
      await u.page.waitForURL((x) => x.pathname === "/sin-acceso");
      await u.page.goto("/logistica");
      await expect(u.page).toHaveURL(/\/sin-acceso$/);
    } finally {
      borrar(email);
    }
  });

  test("el Admin no puede desactivarse ni quitarse el rol", async ({ abrir }) => {
    const page = await abrir("admin", "/admin");
    await page.locator("main").getByRole("button", { name: /admin@erp\.local/ }).click();
    const ficha = page.getByRole("dialog", { name: "Administrador" });
    await expect(ficha.getByRole("button", { name: "Restablecer contraseña" })).toBeVisible();
    await expect(ficha.getByRole("button", { name: "Desactivar cuenta" })).toHaveCount(0);
  });
});
