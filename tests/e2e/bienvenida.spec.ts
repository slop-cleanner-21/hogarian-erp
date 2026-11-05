import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Entregar los accesos (migración prod1_bienvenida): el Admin crea la cuenta con un link de un solo uso (o una
// contraseña temporal) y lo pasa por WhatsApp; con el link, el usuario completa sus datos (solo esa vez), crea su
// contraseña y, si quiere, activa la huella. Después el link deja de servir.

const CLAVE = "Bienvenida-e2e-1";

async function conHuella(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return page;
}

/** Un navegador nuevo, con la contraseña de la demo (si la hay), en el link. */
async function abrirLink(browser: Browser, info: { project: { use: object } }, url: string, huella = false) {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = huella ? await conHuella(ctx) : await ctx.newPage();
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto(url);
  return { ctx, page };
}

const borrar = (email: string) =>
  sqlScript(`delete from audit_log where registro in (select id::text from auth.users where email = '${email}') or user_id in (select id from auth.users where email = '${email}');
             delete from public.perfiles where user_id in (select id from auth.users where email = '${email}');
             delete from auth.users where email = '${email}';`);

/** Crea la cuenta desde Admin › Usuarios; devuelve la hoja «Cuenta creada». */
async function crearCuenta(admin: Page, datos: { nombre: string; email: string; rol: string; celular?: string; dni?: string; acceso: "Link de acceso" | "Contraseña" }) {
  await admin.getByRole("button", { name: "Nuevo usuario" }).click();
  const hoja = admin.getByRole("dialog", { name: "Nuevo usuario" });
  await hoja.getByLabel("Nombre").fill(datos.nombre);
  await hoja.getByLabel("Correo").fill(datos.email);
  await hoja.getByRole("button", { name: "Rol", exact: true }).click();
  await admin.getByRole("listbox", { name: "Rol" }).getByRole("option", { name: datos.rol, exact: true }).click();
  if (datos.dni) await hoja.getByLabel(/^DNI/).fill(datos.dni);
  if (datos.celular) await hoja.getByLabel(/^Celular/).fill(datos.celular);
  await hoja.getByRole("radio", { name: datos.acceso }).click();
  await hoja.getByRole("button", { name: "Crear cuenta" }).click();
  return admin.getByRole("dialog", { name: "Cuenta creada" });
}

test.describe("@admin @bienvenida link de acceso de un solo uso", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
  });

  test("el Admin crea la cuenta con un link; el usuario completa sus datos, crea su contraseña y activa la huella; el link deja de servir", async ({ abrir, browser }, info) => {
    test.setTimeout(120_000);
    const email = `e2e-bienvenida-${Date.now()}@erp.local`;
    try {
      const admin = await abrir("admin", "/admin");
      const creada = await crearCuenta(admin, { nombre: "Rosa", email, rol: "Tesorería", celular: "987 654 321", acceso: "Link de acceso" });
      const credenciales = creada.getByRole("region", { name: "Credenciales" });
      await expect(credenciales).toContainText("/bienvenida/");
      const url = (await credenciales.innerText()).match(/https?:\/\/\S+\/bienvenida\/[A-Za-z0-9_-]+/)![0];
      // WhatsApp al número de la cuenta, con el link en el mensaje.
      const wa = creada.getByRole("link", { name: /Enviar por WhatsApp a \+51 987 654 321/ });
      const href = new URL((await wa.getAttribute("href"))!);
      expect(href.origin + href.pathname).toBe("https://wa.me/51987654321");
      expect(href.searchParams.get("text")).toContain(url);
      // Sin el link, todavía no tiene contraseña: no entra.
      expect(sql1(`select count(*) from credenciales c join auth.users u on u.id = c.user_id where u.email = '${email}'`)).toBe("0");

      // El usuario abre el link: sus datos (solo esta vez) y su contraseña.
      const { ctx, page } = await abrirLink(browser, info, new URL(url).pathname, true);
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByLabel("Nombres")).toHaveValue("Rosa");
      await expect(page.getByLabel(/^Celular/)).toHaveValue("+51 987 654 321");
      await page.getByLabel("Nombres").fill("Rosa María");
      await page.getByLabel("Apellidos").fill("Quispe Huamán");
      await page.getByLabel(/^DNI/).fill("45678912");
      await page.getByLabel(/^Celular/).fill("912345678");
      await page.getByLabel(/^Contraseña/).fill(CLAVE);
      await page.getByLabel("Repetir la contraseña").fill(CLAVE);
      await page.getByRole("button", { name: "Guardar y entrar" }).click();
      // La huella (opcional).
      await page.getByRole("button", { name: "Activar huella" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/tesoreria"), { timeout: 20_000 });
      const id = sql1(`select id from auth.users where email = '${email}'`);
      // Nombres y apellidos por separado; el nombre completo lo arma la base (y pasa al token).
      expect(sql(`select p.nombres, p.apellidos, p.nombre, pp.dni, pp.telefono, u.raw_app_meta_data->>'nombre' from perfiles p join perfil_privado pp on pp.user_id = p.user_id
                   join auth.users u on u.id = p.user_id where p.user_id = '${id}'`)).toEqual([
        ["Rosa María", "Quispe Huamán", "Rosa María Quispe Huamán", "45678912", "51912345678", "Rosa María Quispe Huamán"],
      ]);
      expect(sql1(`select count(*) from huellas where user_id = '${id}'`)).toBe("1");
      expect(sql1(`select count(*) from invitaciones where user_id = '${id}' and usada_at is not null`)).toBe("1");
      expect(sql1(`select string_agg(accion, ',' order by id) from audit_log where tabla in ('usuarios', 'sesion') and registro = '${id}'`)).toMatch(/CREAR_USUARIO.*BIENVENIDA.*LOGIN/);
      await ctx.close();

      // Ya no sirve: ni para volver a cambiar los datos.
      const otra = await abrirLink(browser, info, new URL(url).pathname);
      await expect(otra.page.getByRole("heading", { name: "Este link ya no sirve" })).toBeVisible();
      await expect(otra.page.getByLabel("Nombres")).toHaveCount(0);
      // En su ficha, el Admin los ve por separado.
      await admin.reload();
      await admin.locator("main").getByRole("button", { name: /Rosa María Quispe Huamán/ }).click();
      const ficha = admin.getByRole("dialog", { name: "Rosa María Quispe Huamán", exact: true });
      await expect(ficha.getByLabel("Nombres")).toHaveValue("Rosa María");
      await expect(ficha.getByLabel("Apellidos")).toHaveValue("Quispe Huamán");
      // Y entra con la contraseña que creó.
      await otra.page.goto("/login");
      await otra.page.locator('input[name="email"]').fill(email);
      await otra.page.locator('input[name="password"]').fill(CLAVE);
      await otra.page.getByRole("button", { name: "Ingresar", exact: true }).click();
      await otra.page.waitForURL((u) => u.pathname.startsWith("/tesoreria"));
      await otra.ctx.close();
    } finally {
      sql(`delete from huellas where user_id in (select id from auth.users where email = '${email}')`);
      borrar(email);
    }
  });

  test("un link nuevo (o una contraseña temporal) invalida el anterior; Gerencia debe poner su DNI", async ({ abrir, browser }, info) => {
    test.setTimeout(120_000);
    const email = `e2e-bienvenida-g-${Date.now()}@erp.local`;
    try {
      const admin = await abrir("admin", "/admin");
      // El menú de compartir del teléfono (en la prueba, simulado: guarda lo que se compartió).
      await admin.addInitScript(() => {
        Object.defineProperty(navigator, "share", { value: async (d: ShareData) => ((window as unknown as { compartido: ShareData }).compartido = d), configurable: true });
      });
      await admin.reload();
      const creada = await crearCuenta(admin, { nombre: "Gerente E2E", email, rol: "Gerencia", dni: "11223344", acceso: "Link de acceso" });
      const primero = (await creada.getByRole("region", { name: "Credenciales" }).innerText()).match(/\/bienvenida\/[A-Za-z0-9_-]+/)![0];
      // Sin celular: compartirlo por donde se quiera (el menú del teléfono) o copiarlo.
      await expect(creada.getByRole("button", { name: "Copiar mensaje" })).toBeVisible();
      await creada.getByRole("button", { name: "Compartir" }).click();
      const compartido = await admin.evaluate(() => (window as unknown as { compartido?: ShareData }).compartido);
      expect(compartido?.text).toContain(primero);
      expect(compartido?.text).toContain("Hola Gerente");
      await creada.getByRole("button", { name: "Listo" }).click();

      // Otro link desde su ficha: el primero deja de servir.
      await admin.locator("main").getByRole("button", { name: new RegExp(email) }).click();
      const ficha = admin.getByRole("dialog", { name: "Gerente E2E", exact: true });
      await ficha.getByRole("button", { name: "Link de acceso" }).click();
      await admin.getByRole("dialog").filter({ hasText: "¿Generar un link de acceso?" }).getByRole("button", { name: /^Sí/ }).click();
      const segundo = (await ficha.getByRole("region", { name: "Credenciales" }).innerText()).match(/\/bienvenida\/[A-Za-z0-9_-]+/)![0];
      expect(segundo).not.toBe(primero);
      const viejo = await abrirLink(browser, info, primero);
      await expect(viejo.page.getByRole("heading", { name: "Este link ya no sirve" })).toBeVisible();
      await viejo.ctx.close();

      // Gerencia: el DNI es obligatorio (va en los contratos).
      const { ctx, page } = await abrirLink(browser, info, segundo);
      await expect(page.getByLabel("DNI", { exact: true })).toHaveValue("11223344");
      await page.getByLabel("Apellidos").fill("Prueba");
      await page.getByLabel("DNI", { exact: true }).fill("");
      await page.getByLabel(/^Contraseña/).fill(CLAVE);
      await page.getByLabel("Repetir la contraseña").fill(CLAVE);
      await expect(page.getByRole("button", { name: "Guardar y entrar" })).toBeDisabled();
      await ctx.close();

      // Una contraseña temporal también invalida el link.
      await ficha.getByRole("button", { name: "Restablecer contraseña" }).click();
      await admin.getByRole("dialog").filter({ hasText: "¿Restablecer la contraseña?" }).getByRole("button", { name: /^Sí/ }).click();
      await expect(ficha.getByRole("region", { name: "Credenciales" })).toContainText("Contraseña");
      const despues = await abrirLink(browser, info, segundo);
      await expect(despues.page.getByRole("heading", { name: "Este link ya no sirve" })).toBeVisible();
      await despues.ctx.close();
    } finally {
      borrar(email);
    }
  });

  test("con contraseña temporal, WhatsApp lleva el correo y la contraseña", async ({ abrir }) => {
    const email = `e2e-bienvenida-c-${Date.now()}@erp.local`;
    try {
      const admin = await abrir("admin", "/admin");
      const creada = await crearCuenta(admin, { nombre: "Luis", email, rol: "Logística", celular: "+51 999 888 777", acceso: "Contraseña" });
      const clave = (await creada.getByRole("region", { name: "Credenciales" }).innerText()).match(/Contraseña\s+(\S+)/)![1];
      const href = new URL((await creada.getByRole("link", { name: /Enviar por WhatsApp/ }).getAttribute("href"))!);
      expect(href.pathname).toBe("/51999888777");
      expect(href.searchParams.get("text")).toContain(email);
      expect(href.searchParams.get("text")).toContain(clave);
      expect(sql1(`select count(*) from invitaciones i join auth.users u on u.id = i.user_id where u.email = '${email}'`)).toBe("0");
    } finally {
      borrar(email);
    }
  });

  test("un link inventado no sirve, y nadie lee las invitaciones", async ({ browser }, info) => {
    const { ctx, page } = await abrirLink(browser, info, `/bienvenida/${"x".repeat(43)}`);
    await expect(page.getByRole("heading", { name: "Este link ya no sirve" })).toBeVisible();
    await ctx.close();
    expect(sql1(`select has_table_privilege('authenticated', 'public.invitaciones', 'select') or has_table_privilege('anon', 'public.invitaciones', 'select')`)).toBe("f");
    expect(sql1(`select has_function_privilege('authenticated', 'public.bienvenida_completar(text, text, text, text, text, text)', 'execute')`)).toBe("f");
  });
});
