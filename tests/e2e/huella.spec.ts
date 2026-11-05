import fs from "node:fs";
import type { BrowserContext, Cookie, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sql, sql1 } from "./lib";

const SB = "http://127.0.0.1:55321";
const ANON = /^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m.exec(fs.readFileSync(".env.local", "utf8"))![1].trim().replace(/^["']|["']$/g, "");

/** El token de la sesión del navegador (la cookie de Supabase, que puede venir en partes). */
function tokenDe(cookies: Cookie[]) {
  const partes = cookies
    .filter((c) => c.name === "sb-prod1-auth-token" || c.name.startsWith("sb-prod1-auth-token."))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((c) => decodeURIComponent(c.value))
    .join("");
  const json = partes.startsWith("base64-") ? Buffer.from(partes.slice(7), "base64url").toString("utf8") : partes;
  return JSON.parse(json).access_token as string;
}
/** Lo que la base le da a ese token, directo por la API (sin pasar por la app). */
async function directo(jwt: string) {
  const h = { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  const obras = (await (await fetch(`${SB}/rest/v1/obras?select=id`, { headers: h })).json()) as unknown[];
  const rol = await (await fetch(`${SB}/rest/v1/rpc/mi_rol`, { method: "POST", headers: h, body: "{}" })).json();
  return { obras: obras.length, rol };
}

// Huella (passkey): se activa desde el menú, sirve para entrar sin contraseña y para desbloquear la app al volver
// tras un rato; se quita desde el menú. El lector de huella es el autenticador virtual de Chromium (CDP).
// Todo queda en la auditoría. Usa la cuenta del Jefe de Operaciones (sin otras pruebas que escriban con ella).

const EMAIL = ROLES.jefe;
const uid = () => sql1(`select id from auth.users where email = '${EMAIL}'`);

async function conHuella(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return page;
}

async function alLogin(page: Page) {
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto("/login");
}

async function menu(page: Page, opcion: string) {
  await page.getByRole("button", { name: "Usuario" }).click();
  await page.getByRole("button", { name: opcion, exact: true }).click();
}

const auditoria = (accion: string, desde: string) =>
  Number(sql1(`select count(*) from audit_log where tabla in ('sesion', 'huellas') and accion = '${accion}' and coalesce(user_id::text, '') = '${uid()}' and id > ${desde}`));

test.describe("@huella", () => {
  // Las tres usan la misma cuenta.
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    sql(`delete from huellas where user_id = '${uid()}'`);
  });
  test.afterEach(() => {
    sql(`delete from huellas where user_id = '${uid()}'; delete from sesiones_bloqueo where user_id = '${uid()}'`);
  });

  test("activar, entrar con huella, desbloquear y quitar", async ({ browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: solo en m390");
    const desde = sql1(`select coalesce(max(id), 0) from audit_log`);
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await conHuella(ctx);

    // Sin huella activada, el login no la ofrece.
    await alLogin(page);
    await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar con huella" })).toHaveCount(0);
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));

    // Activar en este dispositivo.
    await menu(page, "Huella");
    await page.getByRole("button", { name: "Activar en este dispositivo" }).click();
    await expect(page.getByText(/· este$/)).toBeVisible();
    expect(sql1(`select count(*) from huellas where user_id = '${uid()}'`)).toBe("1");
    await expect(page.getByRole("button", { name: "Activar en este dispositivo" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Cerrar sesión: el login ofrece la huella (sin pedirla solo) y entra con ella.
    await page.getByRole("button", { name: "Usuario" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.waitForURL(/\/login/);
    await page.getByRole("button", { name: "Entrar con huella" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    expect(sql1(`select count(*) from audit_log where tabla = 'sesion' and accion = 'LOGIN' and detalle->>'metodo' = 'huella' and user_id = '${uid()}' and id > ${desde}`)).toBe("1");

    // Al abrir la app de nuevo (aunque se haya cerrado hace un momento), se bloquea y se desbloquea con la huella.
    // (Una app recién abierta no tiene la marca de esta sesión: se simula quitándola antes de que cargue.)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("e2e_bloqueo")) return;
      sessionStorage.setItem("e2e_bloqueo", "1");
      localStorage.setItem("prod1_huella_visto", String(Date.now()));
      sessionStorage.removeItem("prod1_huella_abierta");
    });
    await page.reload();
    await expect.poll(() => auditoria("DESBLOQUEO", desde), { timeout: 15_000 }).toBe(1);
    await expect(page.getByRole("dialog", { name: "App bloqueada" })).toHaveCount(0);
    // La pantalla se ve (el velo previo al bloqueo se quitó).
    await expect(page.locator("html")).not.toHaveAttribute("data-bloqueo", "1");
    await expect(page.getByRole("button", { name: "Usuario" })).toBeVisible();

    // Quitarla: ya no se ofrece al entrar.
    await menu(page, "Huella");
    await page.getByRole("button", { name: "Quitar" }).click();
    await expect(page.getByText("Sin dispositivos")).toBeVisible();
    expect(sql1(`select count(*) from huellas where user_id = '${uid()}'`)).toBe("0");
    expect(await page.evaluate(() => localStorage.getItem("prod1_huella"))).toBeNull();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Usuario" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.waitForURL(/\/login/);
    await expect(page.getByRole("button", { name: "Entrar con huella" })).toHaveCount(0);

    // Auditoría: activó y quitó la huella (con su autor).
    expect(auditoria("INSERT", desde)).toBe(1);
    expect(auditoria("DELETE", desde)).toBe(1);
    await ctx.close();
  });

  test("una huella quitada desde otro dispositivo deja de ofrecerse", async ({ browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: solo en m390");
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await conHuella(ctx);
    await alLogin(page);
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await menu(page, "Huella");
    await page.getByRole("button", { name: "Activar en este dispositivo" }).click();
    await expect(page.getByText(/· este$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Usuario" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.waitForURL(/\/login/);

    // Otro dispositivo la quitó: al usarla, falla y el login deja de ofrecerla.
    sql(`delete from huellas where user_id = '${uid()}'`);
    await page.getByRole("button", { name: "Entrar con huella" }).click();
    await expect(page.getByText("No se reconoció la huella")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar con huella" })).toHaveCount(0);
    await ctx.close();
  });

  test("otra persona entra con contraseña: la huella del dispositivo ya no se ofrece", async ({ browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: solo en m390");
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await conHuella(ctx);
    await alLogin(page);
    await page.evaluate((e) => localStorage.setItem("prod1_huella", JSON.stringify({ u: "x", e, c: "y" })), EMAIL);
    await page.reload();
    await expect(page.getByRole("button", { name: "Entrar con huella" })).toBeVisible();
    await page.locator('input[name="email"]').fill(ROLES.gerencia);
    await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    expect(await page.evaluate(() => localStorage.getItem("prod1_huella"))).toBeNull();
    await ctx.close();
  });

  test("el servidor hace cumplir el bloqueo: sin «desbloqueado» no entrega pantallas, ni sin JavaScript", async ({ browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: solo en m390");
    const desde = sql1(`select coalesce(max(id), 0) from audit_log`);
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await conHuella(ctx);
    await alLogin(page);
    await page.locator('input[name="email"]').fill(EMAIL);
    await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await menu(page, "Huella");
    await page.getByRole("button", { name: "Activar en este dispositivo" }).click();
    await expect(page.getByText(/· este$/)).toBeVisible();
    const nombres = (await ctx.cookies()).map((c) => c.name);
    expect(nombres).toEqual(expect.arrayContaining(["prod1_huella_disp", "prod1_desbloqueo"]));
    // Las cookies del bloqueo no las lee ni las fabrica el navegador.
    expect((await ctx.cookies()).filter((c) => c.name.startsWith("prod1_huella_disp") || c.name === "prod1_desbloqueo").every((c) => c.httpOnly)).toBe(true);

    const jwt = tokenDe(await ctx.cookies());
    expect(await directo(jwt)).toEqual({ obras: expect.any(Number), rol: "JEFE_OPERACIONES" });

    // Pasa el tiempo sin usarla: el «desbloqueado» vence (en la base, que es la que manda, y su cookie).
    sql(`update sesiones_bloqueo set desbloqueado_hasta = now() where user_id = '${uid()}'`);
    await ctx.clearCookies({ name: "prod1_desbloqueo" });

    // Sin JavaScript (lo que se haría para saltarse el bloqueo del navegador): ninguna pantalla, ni el latido.
    const sinJs = await browser.newContext({ ...info.project.use, javaScriptEnabled: false, storageState: await ctx.storageState() });
    const ver = await sinJs.newPage();
    await ver.goto("/operaciones");
    await expect(ver).toHaveURL(/\/desbloquear\?volver=%2Foperaciones/);
    await expect(ver.locator("main")).not.toContainText("Materiales");
    expect((await sinJs.request.post("/vivo")).status()).toBe(401);
    expect((await sinJs.request.get("/admin/auditoria/csv", { maxRedirects: 0 })).status()).toBe(307);
    await sinJs.close();

    // Borrar las cookies del bloqueo (DevTools) tampoco: lo sabe la base, por la sesión.
    const sinCookies = await browser.newContext({ ...info.project.use, javaScriptEnabled: false, storageState: await ctx.storageState() });
    await sinCookies.clearCookies({ name: "prod1_huella_disp" });
    await sinCookies.clearCookies({ name: "prod1_sin_bloqueo" });
    const ver2 = await sinCookies.newPage();
    await ver2.goto("/operaciones");
    await expect(ver2).toHaveURL(/\/desbloquear\?volver=%2Foperaciones/);
    expect((await sinCookies.request.post("/vivo")).status()).toBe(401);
    await sinCookies.close();
    // Y el token de la sesión, directo contra la API: la base no le da nada ni la reconoce con su rol.
    expect(await directo(jwt)).toEqual({ obras: 0, rol: "" });

    // Con la huella: la pantalla de desbloqueo la pide, el servidor la verifica y vuelve a donde iba.
    await page.goto("/operaciones");
    await page.waitForURL((u) => u.pathname === "/operaciones", { timeout: 20_000 });
    await expect(page.locator("main")).toContainText("Materiales");
    await expect.poll(() => auditoria("DESBLOQUEO", desde), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    // Desbloqueado: el latido lo mantiene, y la base vuelve a darle sus datos.
    expect((await page.request.post("/vivo")).status()).toBe(204);
    expect((await directo(jwt)).rol).toBe("JEFE_OPERACIONES");
    await ctx.close();
  });
});

test.describe("@login", () => {
  test("el login cambia entre claro y oscuro", async ({ browser }, info) => {
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await ctx.newPage();
    await alLogin(page);
    const oscuro = info.project.use.colorScheme === "dark";
    await page.getByRole("button", { name: oscuro ? "Modo claro" : "Modo oscuro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", oscuro ? "light" : "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", oscuro ? "light" : "dark");
    await expect(page.getByRole("button", { name: oscuro ? "Modo oscuro" : "Modo claro" })).toBeVisible();
    await ctx.close();
  });

  test("el ojo muestra y oculta la contraseña", async ({ browser }, info) => {
    const ctx = await browser.newContext({ ...info.project.use });
    const page = await ctx.newPage();
    await alLogin(page);
    const campo = page.getByLabel("Contraseña", { exact: true });
    await campo.fill("secreta-123");
    await expect(campo).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Mostrar contraseña" }).click();
    await expect(campo).toHaveAttribute("type", "text");
    await expect(campo).toHaveValue("secreta-123");
    await page.getByRole("button", { name: "Ocultar contraseña" }).click();
    await expect(campo).toHaveAttribute("type", "password");
    await ctx.close();
  });
});
