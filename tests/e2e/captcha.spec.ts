import crypto from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sql, sql1 } from "./lib";

// Ingreso: desde el 3.er intento fallido desde una IP, esa IP pide CAPTCHA (Cloudflare Turnstile) para siempre, y
// espera cada vez más entre intentos fallidos (5 s, 10 s…). La IP se simula con X-Forwarded-For, solo en los
// pedidos a la app (en local la cabecera se respeta; en Vercel la pone Vercel con la IP real). Turnstile usa las
// claves de prueba de Cloudflare (siempre aprueban): necesita internet.

const ipDePrueba = () => `203.0.113.${crypto.randomInt(1, 255)}`; // TEST-NET-3 (no existe en internet)

async function desdeIp(browser: Browser, info: { project: { use: object } }, ip: string, opciones: { javaScriptEnabled?: boolean } = {}) {
  const ctx = await browser.newContext({ ...info.project.use, ...opciones });
  // La IP simulada solo hacia la app (no hacia Cloudflare).
  await ctx.route(
    (u) => u.host === new URL(test.info().project.use.baseURL!).host,
    (r) => r.continue({ headers: { ...r.request().headers(), "x-forwarded-for": ip } }),
  );
  const page = await ctx.newPage();
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto("/login");
  return { ctx, page };
}

/** Un intento, esperando la respuesta del servidor (si no, el mismo mensaje del intento anterior engaña). */
async function intentar(page: Page, email: string, clave: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(clave);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"),
    page.getByRole("button", { name: /^Ingresar/ }).click(),
  ]);
}

/** El mensaje del formulario (no el anunciador de rutas de Next, que también es «alert»). */
const mensaje = (page: Page) => page.locator('p[role="alert"]');

const limpiar = (ip: string) =>
  sql(`delete from login_ips where ip = '${ip}'; delete from audit_log where tabla = 'sesion' and detalle->>'ip' = '${ip}'`);

test.describe("@seguridad @captcha reintentos y CAPTCHA por IP", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const conInternet = await fetch("https://challenges.cloudflare.com/turnstile/v0/api.js", { redirect: "manual" }).then(
      () => true,
      () => false,
    );
    test.skip(!conInternet, "sin internet: Turnstile no carga");
  });

  test("desde el 3.er intento fallido la IP pide CAPTCHA para siempre, espera antes de reintentar y con él se entra", async ({ browser }, info) => {
    const ip = ipDePrueba();
    const falso = `e2e-captcha-${crypto.randomUUID().slice(0, 8)}@erp.local`;
    const abiertos: BrowserContext[] = [];
    try {
      const { ctx, page } = await desdeIp(browser, info, ip);
      abiertos.push(ctx);
      // Sin fallos: sin CAPTCHA.
      await expect(page.locator("[data-captcha]")).toHaveCount(0);
      for (let i = 1; i <= 3; i++) {
        await intentar(page, falso, "no-es-esta-1");
        await expect(mensaje(page)).toHaveText("Correo o contraseña incorrectos");
      }
      // Al 3.º: el CAPTCHA aparece, la IP queda marcada y la auditoría lo dice.
      await expect(page.locator('[data-captcha="visible"]')).toBeVisible();
      expect(sql1(`select fallos || ' ' || (captcha_desde is not null) from login_ips where ip = '${ip}'`)).toBe("3 true");
      expect(sql1(`select count(*) from audit_log where tabla = 'sesion' and accion = 'CAPTCHA_IP' and detalle->>'ip' = '${ip}'`)).toBe("1");

      // Reintentar enseguida: espera (5 s tras el 3.er fallo) con la cuenta regresiva.
      const token = page.locator('input[name="cf-turnstile-response"]');
      await expect(token).not.toHaveValue("", { timeout: 20_000 });
      await intentar(page, falso, "no-es-esta-2");
      await expect(mensaje(page)).toHaveText(/^Espera \d+ s para volver a intentarlo$/);
      await expect(page.getByRole("button", { name: /^Ingresar \(\d+\)$/ })).toBeDisabled();

      // Pasada la espera, con el CAPTCHA resuelto, se entra.
      await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeEnabled({ timeout: 30_000 });
      await expect(token).not.toHaveValue("", { timeout: 20_000 });
      await intentar(page, ROLES.tesoreria, process.env.ERP_PASS!);
      await page.waitForURL((u) => !u.pathname.startsWith("/login"));

      // Para siempre: otra visita desde esa IP ya lo pide desde el primer intento.
      const otra = await desdeIp(browser, info, ip);
      abiertos.push(otra.ctx);
      await expect(otra.page.locator('[data-captcha="visible"]')).toBeVisible();
    } finally {
      for (const c of abiertos) await c.close().catch(() => {});
      limpiar(ip);
    }
  });

  test("el servidor exige el CAPTCHA a una IP marcada: enviar el formulario a mano, sin el token, no entra", async ({ browser }, info) => {
    const ip = ipDePrueba();
    sql(`insert into login_ips (ip, fallos, captcha_desde, ultimo_fallo_at) values ('${ip}', 3, now(), now() - interval '1 hour')`);
    try {
      // Sin JavaScript (no hay widget ni token) y con el botón deshabilitado: se envía lo que mandaría el formulario,
      // con sus campos ocultos de la acción, como haría un script.
      const { ctx, page } = await desdeIp(browser, info, ip, { javaScriptEnabled: false });
      await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeDisabled();
      const ocultos: Record<string, string> = {};
      const campos = page.locator('form input[type="hidden"]');
      for (let i = 0; i < (await campos.count()); i++) {
        const nombre = await campos.nth(i).getAttribute("name");
        if (nombre) ocultos[nombre] = (await campos.nth(i).getAttribute("value")) ?? "";
      }
      expect(Object.keys(ocultos).some((k) => k.startsWith("$ACTION"))).toBe(true);
      const r = await page.request.post("/login", {
        multipart: { ...ocultos, email: ROLES.tesoreria, password: process.env.ERP_PASS! },
        headers: { "x-forwarded-for": ip, Origin: info.project.use.baseURL! },
        maxRedirects: 0,
      });
      expect(await r.text()).toContain("Completa la verificación");
      expect((await ctx.cookies()).some((c) => c.name.startsWith("sb-prod1-auth-token"))).toBe(false);
      await ctx.close();
    } finally {
      limpiar(ip);
    }
  });
});
