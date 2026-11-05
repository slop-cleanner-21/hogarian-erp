import crypto from "node:crypto";
import fs from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sesionApi, sql, sql1, sqlScript } from "./lib";

// Ingreso con contraseña (migración prod1_credenciales, src/app/login/actions.ts):
// - la contraseña la verifica el servidor (`credenciales`); en Supabase Auth hay una al azar: probarlas directo contra
//   su API no sirve, ni cambiarla ahí con un token;
// - 3 intentos fallidos por cuenta y 10 por IP en 10 minutos; pasado el tope, espera.
// La IP se simula con X-Forwarded-For, solo en los pedidos a la app (en local la cabecera se respeta; en Vercel la
// pone Vercel con la IP real).

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
const CLAVE = () => process.env.ERP_PASS!;

// 198.18.0.0/15 (reservada para pruebas: no existe en internet), con muchas opciones: dos pruebas en paralelo no
// comparten la IP por azar.
const ipDePrueba = () => `198.${crypto.randomInt(18, 20)}.${crypto.randomInt(0, 256)}.${crypto.randomInt(1, 255)}`;

async function desdeIp(browser: Browser, info: { project: { use: object } }, ip: string) {
  const ctx = await browser.newContext({ ...info.project.use });
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

/** Un intento, esperando la respuesta del servidor (si no, el mensaje del intento anterior engaña). */
async function intentar(page: Page, email: string, clave: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(clave);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"),
    page.getByRole("button", { name: /^Ingresar/ }).click(),
  ]);
}
const mensaje = (page: Page) => page.locator('p[role="alert"]');

/** Una cuenta de Tesorería solo para la prueba (bloquear la de los demás frenaría las otras pruebas). */
async function cuentaTemporal() {
  const email = `e2e-ingreso-${crypto.randomUUID().slice(0, 8)}@erp.local`;
  const r = await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const id = ((await r.json()) as { id: string }).id;
  sql(`insert into perfiles (user_id, nombre, rol) values ('${id}', 'E2E Ingreso', 'TESORERIA'); select fijar_contrasena('${id}', '${CLAVE()}')`);
  return {
    id,
    email,
    borrar: () => {
      sql(`delete from audit_log where (tabla = 'sesion' and detalle->>'email' = '${email}') or user_id = '${id}' or registro = '${id}'`);
      sql(`delete from auth.users where id = '${id}'`);
    },
  };
}

test.describe("@seguridad @ingreso intentos y contraseñas", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
  });

  test("3 intentos fallidos por cuenta: espera, ni con la contraseña correcta; las demás cuentas entran", async ({ browser }, info) => {
    const c = await cuentaTemporal();
    const ip = ipDePrueba();
    try {
      const { ctx, page } = await desdeIp(browser, info, ip);
      for (let i = 1; i <= 3; i++) {
        await intentar(page, c.email, "no-es-esta-1");
        await expect(mensaje(page)).toHaveText("Correo o contraseña incorrectos");
      }
      // El 4.º, aun con la correcta: espera (cerca de 10 minutos), con la cuenta regresiva.
      await intentar(page, c.email, CLAVE());
      await expect(mensaje(page)).toHaveText(/^Demasiados intentos\. Vuelve a intentarlo en (10|9) min$/);
      await expect(page.getByRole("button", { name: /^Ingresar \(\d+ min\)$/ })).toBeDisabled();
      await expect(page).toHaveURL(/\/login/);
      await ctx.close();

      // Desde la misma IP, otra cuenta entra (el tope por IP es otro: no se bloquea a toda una oficina).
      const otra = await desdeIp(browser, info, ip);
      await intentar(otra.page, ROLES.tesoreria, CLAVE());
      await otra.page.waitForURL((u) => !u.pathname.startsWith("/login"));
      await otra.ctx.close();

      // Pasados los 10 minutos (se simula moviendo los intentos), la cuenta entra.
      sql(`update audit_log set created_at = created_at - interval '11 minutes' where tabla = 'sesion' and detalle->>'email' = '${c.email}'`);
      const luego = await desdeIp(browser, info, ip);
      await intentar(luego.page, c.email, CLAVE());
      await luego.page.waitForURL((u) => !u.pathname.startsWith("/login"));
      await luego.ctx.close();
    } finally {
      c.borrar();
      sql(`delete from audit_log where tabla = 'sesion' and detalle->>'ip' = '${ip}'`);
    }
  });

  test("10 intentos fallidos desde una IP: esa IP espera; desde otra se entra", async ({ browser }, info) => {
    const ip = ipDePrueba();
    sql(`insert into audit_log (tabla, accion, detalle)
         select 'sesion', 'LOGIN_FALLIDO', jsonb_build_object('email', 'e2e-ip-' || g || '@erp.local', 'ip', '${ip}', 'motivo', 'invalid_credentials')
           from generate_series(1, 10) g`);
    try {
      const { ctx, page } = await desdeIp(browser, info, ip);
      await intentar(page, ROLES.tesoreria, CLAVE());
      await expect(mensaje(page)).toHaveText(/^Demasiados intentos/);
      await ctx.close();
      const otra = await desdeIp(browser, info, ipDePrueba());
      await intentar(otra.page, ROLES.tesoreria, CLAVE());
      await otra.page.waitForURL((u) => !u.pathname.startsWith("/login"));
      await otra.ctx.close();
    } finally {
      sql(`delete from audit_log where tabla = 'sesion' and detalle->>'ip' = '${ip}'`);
    }
  });

  test("las contraseñas no están en Supabase Auth: ni probarlas directo ni cambiarlas con un token sirve", async ({ browser }, info) => {
    const c = await cuentaTemporal();
    try {
      // Directo contra la API de Auth, con la contraseña correcta: no entra (ahí hay una al azar).
      const directo = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ email: c.email, password: CLAVE() }),
      });
      expect(directo.status).toBe(400);
      expect(((await directo.json()) as { error_code?: string }).error_code).toBe("invalid_credentials");

      // Con un token de su sesión, cambiarla en Auth: Auth lo acepta, pero no es la que vale.
      const s = await sesionApi(SB, ANON, SECRETA, c.email);
      await fetch(`${SB}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "robada-e2e-123" }),
      });
      const { ctx, page } = await desdeIp(browser, info, ipDePrueba());
      await intentar(page, c.email, "robada-e2e-123");
      await expect(mensaje(page)).toHaveText("Correo o contraseña incorrectos");
      await intentar(page, c.email, CLAVE());
      await page.waitForURL((u) => !u.pathname.startsWith("/login"));
      await ctx.close();
      // Y nadie lee las credenciales.
      const jwt = (await sesionApi(SB, ANON, SECRETA, ROLES.admin)).access_token;
      for (const t of [null, jwt]) {
        const r = await fetch(`${SB}/rest/v1/credenciales?select=hash`, { headers: { apikey: ANON, Authorization: `Bearer ${t ?? ANON}` } });
        expect(r.status, t ? "admin" : "anon").toBeGreaterThanOrEqual(400);
      }
      expect(sql1(`select count(*) from auth.users u join credenciales c on c.user_id = u.id where u.encrypted_password = c.hash`)).toBe("0");
    } finally {
      c.borrar();
    }
  });

  test("el ingreso tarda lo mismo exista o no la cuenta", async () => {
    // Se compara en la base (sin la red): con y sin cuenta, la verificación hace el mismo trabajo (bcrypt, con el costo
    // de las contraseñas que pone la app; las de las semillas locales son más baratas).
    const c = await cuentaTemporal();
    const nadie = `nadie-${crypto.randomUUID().slice(0, 6)}@erp.local`;
    const [fila] = sqlScript(`
      create function pg_temp.medir(p_email text) returns float language plpgsql as $f$
      declare t timestamptz := clock_timestamp();
      begin
        perform public.ingreso_valido(p_email, 'no-es-esta-1');
        return extract(epoch from clock_timestamp() - t) * 1000;
      end $f$;
      select least(pg_temp.medir('${c.email}'), pg_temp.medir('${c.email}'), pg_temp.medir('${c.email}')),
             least(pg_temp.medir('${nadie}'), pg_temp.medir('${nadie}'), pg_temp.medir('${nadie}'));`);
    c.borrar();
    const [existe, noExiste] = fila.map(Number);
    expect(existe).toBeGreaterThan(5);
    expect(Math.abs(existe - noExiste)).toBeLessThan(Math.max(existe, noExiste) * 0.5);
  });
});
