import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ROLES, sql, sql1, sqlScript, uidDe } from "./lib";

// Auditoría: toda tabla del negocio registra sus cambios con su autor; las sesiones (inicio, intento fallido,
// cierre) quedan con IP y dispositivo; lo que el Admin hace con la clave secreta queda a su nombre; y el Admin
// lo ve en Auditoría (y en CSV).

const SIN_AUDITORIA = ["audit_log", "orden_borradores", "notificaciones", "push_suscripciones", "cotizacion_accesos", "datos_demo", "huella_desafios", "credenciales", "sesiones_bloqueo", "invitaciones", "aviso_preferencias"];

async function entrar(browser: Browser, baseURL: string, email: string, pass: string): Promise<Page> {
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
  return page;
}

/** Ejecuta `consulta` como el usuario de `rol` (en una transacción que se deshace) y devuelve su auditoría nueva. */
function comoRol(rol: string, consulta: string) {
  const uid = uidDe(rol);
  const filas = sqlScript(`begin;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
    create temp table antes on commit drop as select coalesce(max(id), 0) m from audit_log;
    set local role authenticated;
    ${consulta};
    reset role;
    select 'A', tabla, accion, coalesce(user_id::text, '-') from audit_log where id > (select m from antes) and tabla <> 'sesion' order by id;
    rollback;`);
  return { uid, filas: filas.filter((f) => f[0] === "A").map((f) => f.slice(1)) };
}

test.describe("@auditoria", () => {
  test("toda tabla del negocio registra sus cambios", () => {
    // Un trigger de fn_audit en alta, cambio y baja, sin filtrar columnas ni condición (el de ítems del MVP solo
    // miraba la cuenta y el tipo: el alta de un ítem no quedaba). Huellas: solo alta y baja, a propósito.
    const sin = sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r'
                        and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgfoid = 'public.fn_audit'::regproc
                                          and t.tgtype & 28 = 28 and t.tgattr::text = '' and t.tgqual is null)
                      order by 1`).map(([t]) => t);
    expect(sin).toEqual([...SIN_AUDITORIA, "huellas"].sort());
  });

  test("cada rol queda como autor de lo que cambia (Logística, Tesorería, Gerencia)", () => {
    // Logística: un transportista y que la OC requiera guía.
    const oc = sql(`select obra_id, numero from ordenes_compra where tipo = 'OC' and estado = 'EMITIDA' order by obra_id, numero limit 1`)[0];
    const l = comoRol(
      "LOGISTICA",
      `insert into transportistas (ruc, razon_social) values ('20999999990', 'E2E TRANSPORTES');
       select set_requiere_guia(${oc[0]}, '${oc[1]}', true)`,
    );
    expect(l.filas).toEqual(expect.arrayContaining([["transportistas", "INSERT", l.uid], ["ordenes_compra", "UPDATE", l.uid]]));
    // Tesorería: un rechazo (la orden y el rechazo).
    const teso = sql(`select obra_id, numero from ordenes_compra where estado = 'EN_TESORERIA' order by obra_id desc, numero limit 1`)[0];
    const t = comoRol("TESORERIA", `select rechazar_documento(${teso[0]}, '${teso[1]}', null, 'Prueba de auditoría', false, 'DATOS')`);
    expect(t.filas).toEqual(expect.arrayContaining([["rechazos", "INSERT", t.uid], ["ordenes_compra", "UPDATE", t.uid]]));
    // Gerencia: el mínimo de la detracción.
    const g = comoRol("GERENCIA", `select guardar_detraccion_minimo((select detraccion_minimo + 1 from parametros))`);
    expect(g.filas).toEqual([["parametros", "UPDATE", g.uid]]);
  });

  test("inicio, intento fallido y cierre de sesión quedan con usuario, IP y dispositivo", async ({ browser }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const base = info.project.use.baseURL!;
    const desde = sql1("select coalesce(max(id), 0) from audit_log");
    const uid = sql1(`select id from auth.users where email = '${ROLES.tesoreria}'`);
    // Intento fallido.
    const mal = await entrar(browser, base, ROLES.tesoreria, "clave-incorrecta");
    await expect(mal.locator("form [role=alert]")).toContainText("incorrectos");
    // Inicio y cierre.
    const page = await entrar(browser, base, ROLES.tesoreria, process.env.ERP_PASS!);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.getByRole("button", { name: "Usuario" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.waitForURL((u) => u.pathname === "/login");
    const filas = sql(`select accion, coalesce(user_id::text, '-'), detalle->>'email', (detalle->>'agente') is not null, detalle ? 'ip'
                         from audit_log where id > ${desde} and tabla = 'sesion' and detalle->>'email' = '${ROLES.tesoreria}' order by id`);
    expect(filas).toEqual([
      ["LOGIN_FALLIDO", "-", ROLES.tesoreria, "t", "t"],
      ["LOGIN", uid, ROLES.tesoreria, "t", "t"],
      ["LOGOUT", uid, ROLES.tesoreria, "t", "t"],
    ]);
    // El intento fallido no se queda contando para la cuenta (3 en 10 minutos la hacen esperar: frenaría las demás).
    sql(`delete from audit_log where id > ${desde} and tabla = 'sesion' and accion = 'LOGIN_FALLIDO' and detalle->>'email' = '${ROLES.tesoreria}'`);
  });

  test("lo que el Admin hace con la clave secreta queda a su nombre; Auditoría lo muestra y lo descarga en CSV", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const admin = sql1(`select id from auth.users where email = '${ROLES.admin}'`);
    const email = `e2e-auditoria-${Date.now()}@erp.local`;
    try {
      const page = await abrir("admin", "/admin");
      await page.getByRole("button", { name: "Nuevo usuario" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo usuario" });
      await hoja.getByLabel("Nombre").fill("Auditoría E2E");
      await hoja.getByLabel("Correo").fill(email);
      await hoja.getByRole("button", { name: "Rol", exact: true }).click();
      await page.getByRole("listbox", { name: "Rol" }).getByRole("option", { name: "Tesorería", exact: true }).click();
      await hoja.getByRole("button", { name: "Crear cuenta" }).click();
      await expect(page.getByRole("dialog", { name: "Cuenta creada" })).toBeVisible();
      const nuevo = sql1(`select id from auth.users where email = '${email}'`);
      // El perfil (trigger, con x-actor) y el evento de la cuenta, a nombre del Admin.
      expect(sql(`select tabla, accion, user_id from audit_log where registro = '${nuevo}' order by id`)).toEqual(
        expect.arrayContaining([["perfiles", "INSERT", admin], ["usuarios", "CREAR_USUARIO", admin]]),
      );

      // Auditoría › Cambios: lo ve, con quién y qué.
      const aud = await abrir("admin", "/admin/auditoria?vista=cambios");
      // La de esta cuenta (en paralelo, otras pruebas también crean cuentas).
      const fila = aud.getByRole("list", { name: "Registro" }).locator("li").filter({ hasText: "Creó la cuenta" }).filter({ hasText: email }).first();
      await expect(fila).toContainText("Administrador");
      await expect(fila).toContainText("Auditoría E2E");
      // Sesiones: los inicios de sesión.
      await aud.getByRole("tab", { name: "Sesiones" }).click();
      await expect(aud.getByRole("list", { name: "Registro" }).locator("li").first()).toBeVisible();
      // CSV.
      const r = await aud.request.get("/admin/auditoria/csv?vista=cambios");
      expect(r.status()).toBe(200);
      expect(r.headers()["content-type"]).toContain("text/csv");
      const texto = await r.text();
      expect(texto.split("\r\n")[0]).toContain("Fecha y hora,Usuario,Acción,Qué,Registro");
      expect(texto).toContain("Creó la cuenta");
    } finally {
      sqlScript(`delete from public.perfiles where user_id in (select id from auth.users where email = '${email}');
                 delete from auth.users where email = '${email}';`);
    }
  });

  test("solo el Admin ve la auditoría", async ({ abrir }) => {
    const page = await abrir("gerencia", "/admin/auditoria");
    expect(new URL(page.url()).pathname).not.toBe("/admin/auditoria");
  });
});
