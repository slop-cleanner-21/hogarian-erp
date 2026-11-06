import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { Browser } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Varias personas a la vez sobre lo mismo, y los avisos de prod 1.
//
// Concurrencia: dos sesiones de la base al mismo tiempo (cada una con su transacción, como dos pedidos de la app). La
// primera actúa y espera antes de confirmar; la segunda queda esperando el bloqueo de la orden y, cuando le toca, la
// base la rechaza porque la orden ya cambió. Corre en el proyecto «flujo» (después de las demás): paga, rechaza y
// cotiza órdenes de los datos de prueba y las deja como estaban.

// Una tras otra: comparten órdenes y la limpieza de una no debe pisar a otra.
test.describe.configure({ mode: "serial" });

type Resultado = { ok: boolean; salida: string; error: string; ms: number };

/** Un script de SQL en su propia sesión, sin esperar a las demás (sql() de lib espera). */
function sqlEnParalelo(script: string): Promise<Resultado> {
  const t = Date.now();
  return new Promise((resolver) => {
    const p = spawn("docker", ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "supabase_db_erp-prod1", "psql", "-U", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"]);
    let salida = "";
    let error = "";
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (error += d));
    p.on("close", (code) => resolver({ ok: code === 0, salida, error, ms: Date.now() - t }));
    p.stdin.end(script);
  });
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Como el usuario, en una transacción; `pausa`: segundos antes de confirmar (mantiene el bloqueo). */
const como = (uid: string, sentencia: string, pausa = 0) => `begin;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
set local role authenticated;
${sentencia};
${pausa ? `select pg_sleep(${pausa});` : ""}
commit;`;

/** Una OC normal en Tesorería, con su factura (solo de ella, sin pagos) y sin guía pendiente: se puede pagar o rechazar. */
function ordenEnTesoreria(salto: number) {
  return sql(
    `select v.obra_id, v.numero, v.saldo from v_por_pagar v join ordenes_compra o on o.obra_id = v.obra_id and o.numero = v.numero
      where v.estado = 'PENDIENTE' and v.doc = 'OC' and not v.falta_guia and o.estado = 'EN_TESORERIA' and not o.historico and v.saldo > 0
        and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        and not exists (select 1 from oc_items l join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
        and not exists (select 1 from oc_items l join oc_items x on x.comprobante_id = l.comprobante_id
                         where l.obra_id = o.obra_id and l.numero_oc = o.numero and (x.obra_id, x.numero_oc) <> (o.obra_id, o.numero))
        and not exists (select 1 from rechazos r where r.obra_id = o.obra_id and r.numero = o.numero and r.reenviado_at is null)
      order by o.obra_id, o.numero offset ${salto} limit 1`,
  )[0];
}

/** Deja la orden como estaba: sin los pagos, rechazos y avisos nuevos, en Tesorería. */
function reponerOrden(obra: string, numero: string) {
  const ultimoPago = sql1("select coalesce(max(id), 0) from pagos");
  const ultimoRechazo = sql1("select coalesce(max(id), 0) from rechazos");
  const ultimoAviso = sql1("select coalesce(max(id), 0) from notificaciones");
  // Solo los pagos nuevos de esta orden.
  const suyos = `select ap.pago_id from pago_aplicaciones ap where ap.pago_id > ${ultimoPago}
                   and ((ap.obra_id = ${obra} and ap.numero_oc = '${numero}')
                        or ap.comprobante_id in (select comprobante_id from oc_items where obra_id = ${obra} and numero_oc = '${numero}'))`;
  return () =>
    sql(`create temp table _pagos as ${suyos};
         delete from adjuntos where pago_id in (select pago_id from _pagos);
         delete from pago_aplicaciones where pago_id in (select pago_id from _pagos);
         delete from pagos where id in (select pago_id from _pagos);
         delete from rechazos where id > ${ultimoRechazo} and obra_id = ${obra} and numero = '${numero}';
         delete from notificaciones where id > ${ultimoAviso} and href like '%/${obra}/${numero}%';
         update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = ${obra} and numero = '${numero}';`);
}

const pagosDe = (obra: string, numero: string) =>
  sql1(`select count(distinct ap.pago_id) from pago_aplicaciones ap
         where (ap.obra_id = ${obra} and ap.numero_oc = '${numero}')
            or ap.comprobante_id in (select comprobante_id from oc_items where obra_id = ${obra} and numero_oc = '${numero}')`);

const pagar = (obra: string, numero: string, saldo: string, marca: string) =>
  `select pagar_documento(${obra}, '${numero}', null, current_date, 'BCP', 'E2E-CONC-${marca}', ${saldo}, 'pagos/e2e-conc-${marca}.png', 'voucher.png')`;
const rechazar = (obra: string, numero: string) =>
  `select rechazar_documento(${obra}, '${numero}', null, 'E2E concurrencia: corregir la cuenta', false, 'DATOS')`;

/** Las cuentas activas de un rol (a quienes les toca un aviso). */
const activos = (rol: string) =>
  sql(`select p.user_id from perfiles p join auth.users u on u.id = p.user_id
        where p.rol::text = '${rol}' and (u.banned_until is null or u.banned_until <= now()) order by 1`).map(([u]) => u);
const destinatarios = (condicion: string) => sql(`select user_id from notificaciones where ${condicion} order by 1`).map(([u]) => u);

test.describe("@concurrencia varias personas sobre la misma orden", () => {
  test("dos pagos de la misma orden a la vez: pasa uno; el otro espera y la base lo rechaza", async () => {
    const [obra, numero, saldo] = ordenEnTesoreria(0);
    test.skip(!obra, "sin órdenes por pagar");
    const reponer = reponerOrden(obra, numero);
    const tes = uidDe("TESORERIA");
    const marca = crypto.randomUUID().slice(0, 8);
    try {
      const primero = sqlEnParalelo(como(tes, pagar(obra, numero, saldo, `${marca}-a`), 1.5));
      await espera(400);
      const segundo = sqlEnParalelo(como(tes, pagar(obra, numero, saldo, `${marca}-b`)));
      const [a, b] = await Promise.all([primero, segundo]);
      expect(a.ok, a.error).toBe(true);
      expect(b.ok).toBe(false);
      // Esperó a que el primero terminara (el bloqueo de la orden), y entonces ya no estaba por pagar.
      expect(b.ms).toBeGreaterThan(1000);
      expect(b.error).toMatch(/no está en Tesorería \(estado PAGADA\)|no tiene saldo/);
      expect(pagosDe(obra, numero)).toBe("1");
      expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("PAGADA");
    } finally {
      reponer();
    }
    expect(pagosDe(obra, numero)).toBe("0");
  });

  test("pagar y rechazar a la vez: gana el primero, en los dos órdenes", async () => {
    const [obra, numero, saldo] = ordenEnTesoreria(1);
    test.skip(!obra, "sin órdenes por pagar");
    const tes = uidDe("TESORERIA");
    for (const [primero, segundo, estado, error] of [
      ["pagar", "rechazar", "PAGADA", /La orden \S+ no está en Tesorería/],
      ["rechazar", "pagar", "FACTURADA", /no está en Tesorería \(estado FACTURADA\)/],
    ] as const) {
      const reponer = reponerOrden(obra, numero);
      const marca = crypto.randomUUID().slice(0, 8);
      const accion = (q: string) => (q === "pagar" ? pagar(obra, numero, saldo, marca) : rechazar(obra, numero));
      try {
        const a = sqlEnParalelo(como(tes, accion(primero), 1.5));
        await espera(400);
        const [ra, rb] = await Promise.all([a, sqlEnParalelo(como(tes, accion(segundo)))]);
        expect(ra.ok, `${primero}: ${ra.error}`).toBe(true);
        expect(rb.ok, `${segundo} después de ${primero}`).toBe(false);
        expect(rb.error, `${segundo} después de ${primero}`).toMatch(error);
        expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe(estado);
        // Una sola cosa: o el pago o el rechazo.
        const rechazos = sql1(`select count(*) from rechazos where obra_id = ${obra} and numero = '${numero}' and motivo like 'E2E concurrencia%'`);
        expect(`${pagosDe(obra, numero)} pago, ${rechazos} rechazo`).toBe(primero === "pagar" ? "1 pago, 0 rechazo" : "0 pago, 1 rechazo");
      } finally {
        reponer();
      }
    }
  });

  test("el proveedor envía su cotización dos veces a la vez: se guarda una", async ({ baseURL }) => {
    const fila = sql(`select o.obra_id, o.numero, o.token_cotizacion from ordenes_compra o
                       where o.token_cotizacion is not null and o.estado = 'EMITIDA' and o.cotizacion_estado = 'ENVIADA'
                       order by o.obra_id, o.numero limit 1`)[0];
    test.skip(!fila, "sin links de cotización abiertos");
    const [obra, numero, token] = fila;
    const items = sql(`select id from oc_items where obra_id = ${obra} and numero_oc = '${numero}' order by id`).map(([i]) => Number(i));
    const ultimoAviso = sql1("select coalesce(max(id), 0) from notificaciones");
    const ultimoAcceso = sql1("select coalesce(max(id), 0) from cotizacion_accesos");
    try {
      const enviar = (pu: number) =>
        fetch(`${baseURL}/cotizar/${token}/enviar`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: baseURL! },
          body: JSON.stringify({ precios: items.map((item_id) => ({ item_id, pu })) }),
        }).then(async (r) => ({ status: r.status, error: ((await r.json()) as { error: string | null }).error }));
      const r = await Promise.all([enviar(11), enviar(22)]);
      expect(r.filter((x) => x.status === 200), JSON.stringify(r)).toHaveLength(1);
      expect(r.find((x) => x.status !== 200)?.error).toMatch(/ya fue enviada|ya no está disponible/);
      // Los precios de un solo envío (no mezclados), y la orden «recibida».
      expect(sql(`select distinct pu_cotizado from oc_items where obra_id = ${obra} and numero_oc = '${numero}'`)).toHaveLength(1);
      expect(sql1(`select cotizacion_estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("RECIBIDA");
      // Un aviso para cada persona de Logística (no dos), que lleva a la orden.
      const avisos = destinatarios(`id > ${ultimoAviso} and tipo = 'COTIZACION_RECIBIDA' and href = '/logistica/ordenes/${obra}/${numero}'`);
      expect(avisos).toEqual(activos("LOGISTICA"));
    } finally {
      sql(`update oc_items set pu_cotizado = null where obra_id = ${obra} and numero_oc = '${numero}';
           update ordenes_compra set cotizacion_estado = 'ENVIADA', cotizacion_recibida_at = null where obra_id = ${obra} and numero = '${numero}';
           delete from cotizacion_accesos where id > ${ultimoAcceso} and obra_id = ${obra} and numero = '${numero}';
           delete from notificaciones where id > ${ultimoAviso} and href like '%/${obra}/${numero}%';`);
    }
  });
});

test.describe("@avisos quién recibe cada aviso y a dónde lleva", () => {
  test("rechazo → Logística (y a la orden); reenvío → Tesorería (y al pago); nunca a una cuenta desactivada", async () => {
    const [obra, numero] = ordenEnTesoreria(2);
    test.skip(!obra, "sin órdenes por pagar");
    const reponer = reponerOrden(obra, numero);
    // Una cuenta de Logística desactivada: no recibe nada.
    const desactivada = crypto.randomUUID();
    sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data,
           created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
         values ('00000000-0000-0000-0000-000000000000', '${desactivada}', 'authenticated', 'authenticated', 'e2e-baja-${desactivada.slice(0, 8)}@erp.local', '',
           now(), now() + interval '100 years', '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '');
         insert into perfiles (user_id, nombre, rol) values ('${desactivada}', 'E2E Desactivada', 'LOGISTICA');`);
    const ultimo = sql1("select coalesce(max(id), 0) from notificaciones");
    try {
      const r1 = await sqlEnParalelo(como(uidDe("TESORERIA"), rechazar(obra, numero)));
      expect(r1.ok, r1.error).toBe(true);
      const rechazo = destinatarios(`id > ${ultimo} and tipo = 'RECHAZO' and href = '/logistica/ordenes/${obra}/${numero}?tipo=OC'`);
      expect(rechazo).toEqual(activos("LOGISTICA"));
      expect(rechazo).not.toContain(desactivada);

      const r2 = await sqlEnParalelo(como(uidDe("LOGISTICA"), `select reenviar_a_tesoreria(${obra}, '${numero}', 'E2E: cuenta corregida')`));
      expect(r2.ok, r2.error).toBe(true);
      expect(destinatarios(`id > ${ultimo} and tipo = 'REENVIO' and href = '/tesoreria/pago/${obra}/${numero}'`)).toEqual(activos("TESORERIA"));
    } finally {
      reponer();
      sql(`delete from perfiles where user_id = '${desactivada}'; delete from auth.users where id = '${desactivada}'`);
    }
  });
});

/** Una cuenta solo para la prueba, de Gerencia: las demás pruebas no le generan avisos (a Logística sí). */
async function cuentaTemporal() {
  const email = `e2e-avisos-${crypto.randomUUID().slice(0, 8)}@erp.local`;
  const id = crypto.randomUUID();
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
       values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}', extensions.crypt('${process.env.ERP_PASS}', extensions.gen_salt('bf')),
         now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '');
       insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (gen_random_uuid(), '${id}', '${id}', jsonb_build_object('sub', '${id}', 'email', '${email}', 'email_verified', true), 'email', now(), now(), now());
       insert into perfiles (user_id, nombre, rol) values ('${id}', 'E2E Avisos', 'GERENCIA');`);
  return { id, email, borrar: () => sql(`delete from notificaciones where user_id = '${id}'; delete from perfiles where user_id = '${id}'; delete from auth.users where id = '${id}'`) };
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
  await page.locator('input[name="password"]').fill(process.env.ERP_PASS!);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/gerencia"));
  return { ctx, page };
}

test.describe("@avisos la campana", () => {
  test("cuenta los nuevos sin recargar; al abrir Avisos quedan leídos y la campana se apaga; cada aviso lleva a su orden", async ({ browser }, info) => {
    const u = await cuentaTemporal();
    try {
      const { ctx, page } = await entrar(browser, info, u.email);
      const campana = page.getByRole("link", { name: /^Avisos/ });
      await expect(campana).toHaveAccessibleName("Avisos");
      // Llegan dos avisos (como los de la base): la campana los cuenta sin recargar (Realtime).
      const [obra, numero] = sql(`select obra_id, numero from ordenes_compra where tipo = 'OC' order by obra_id, numero limit 1`)[0];
      sql(`insert into notificaciones (user_id, tipo, titulo, href) values
             ('${u.id}', 'E2E', 'E2E aviso uno', '/consulta/orden/${obra}/${numero}'),
             ('${u.id}', 'E2E', 'E2E aviso dos', '/consulta/orden/${obra}/${numero}')`);
      await expect(campana).toHaveAccessibleName("Avisos (2 sin leer)", { timeout: 15_000 });
      await expect(campana).toContainText("2");

      // Al abrir Avisos: los dos, y quedan leídos (la pantalla los marca al abrirse).
      await campana.click();
      await page.waitForURL((x) => x.pathname === "/avisos");
      await expect(page.locator("main li").filter({ hasText: /^E2E aviso/ })).toHaveCount(2);
      await expect.poll(() => sql1(`select count(*) from notificaciones where user_id = '${u.id}' and leida_at is null`)).toBe("0");
      await expect(page.getByRole("link", { name: /^Avisos/ })).toHaveAccessibleName("Avisos", { timeout: 15_000 });

      // Tocar un aviso abre su orden.
      await page.getByRole("link", { name: /E2E aviso uno/ }).click();
      await page.waitForURL((x) => x.pathname === `/consulta/orden/${obra}/${encodeURIComponent(numero)}`);
      await expect(page.locator("main")).toContainText(numero);
      await ctx.close();
    } finally {
      u.borrar();
    }
  });

  test("una orden nueva que llega a Tesorería: aviso a Tesorería, al pago (no a Logística)", () => {
    // En una transacción que se revierte: una orden facturada (sin rechazos) que Logística envía.
    const [obra, numero] = ordenEnTesoreria(3) ?? [];
    test.skip(!obra, "sin órdenes por pagar");
    const filas = sqlScript(`begin;
      update ordenes_compra set estado = 'FACTURADA' where obra_id = ${obra} and numero = '${numero}';
      select set_config('request.jwt.claims', '{"sub":"${uidDe("LOGISTICA")}","role":"authenticated"}', true);
      set local role authenticated;
      select enviar_a_tesoreria(${obra}, '${numero}');
      reset role;
      select user_id || '|' || href || '|' || titulo from notificaciones where tipo = 'POR_PAGAR' and created_at = now() order by 1;
      rollback;`).filter((f) => f.length === 3 && /^[0-9a-f-]{36}$/.test(f[0]));
    expect(filas.map(([u]) => u)).toEqual(activos("TESORERIA"));
    expect(new Set(filas.map(([, h]) => h))).toEqual(new Set([`/tesoreria/pago/${obra}/${numero}`]));
    expect(filas[0][2]).toMatch(new RegExp(`^Nueva OC ${numero} por pagar · `));
  });

  test("Gerencia publica un presupuesto: el aviso va al Jefe y al Ingeniero de Operaciones, a su seguimiento", () => {
    // En una transacción que se revierte: una obra con partidas vuelve a borrador y Gerencia la publica.
    const [obra] = sql(`select obra_id from partidas group by 1 order by 1 limit 1`)[0];
    const filas = sqlScript(`begin;
      update obras set presupuesto_estado = 'BORRADOR' where id = ${obra};
      select set_config('request.jwt.claims', '{"sub":"${uidDe("GERENCIA")}","role":"authenticated"}', true);
      set local role authenticated;
      select publicar_presupuesto(${obra});
      reset role;
      select user_id || '|' || href from notificaciones where tipo = 'PRESUPUESTO' and created_at = now() order by 1;
      rollback;`).filter((f) => f.length === 2 && /^[0-9a-f-]{36}$/.test(f[0]));
    expect(filas.length).toBeGreaterThan(0);
    expect(new Set(filas.map(([, h]) => h))).toEqual(new Set([`/operaciones?obra=${obra}`]));
    expect(filas.map(([u]) => u).sort()).toEqual([...activos("JEFE_OPERACIONES"), ...activos("OPERACIONES")].sort());
  });
});

test.describe("@avisos cada uno elige sus avisos", () => {
  test("quien apaga un aviso de su rol no lo recibe; el Admin que se suma sí (sin celular, si así lo eligió)", () => {
    const [obra, numero] = ordenEnTesoreria(4) ?? [];
    test.skip(!obra, "sin órdenes por pagar");
    const log = uidDe("LOGISTICA");
    const admin = uidDe("ADMIN");
    const ger = uidDe("GERENCIA");
    // En una transacción que se revierte: Logística apaga el rechazo; el Admin se suma (sin celular); Gerencia, nada.
    const filas = sqlScript(`begin;
      insert into aviso_preferencias (user_id, tipo, avisar, celular) values ('${log}', 'RECHAZO', false, false), ('${admin}', 'RECHAZO', true, false);
      select set_config('request.jwt.claims', '{"sub":"${uidDe("TESORERIA")}","role":"authenticated"}', true);
      set local role authenticated;
      ${rechazar(obra, numero)};
      reset role;
      select user_id || '|' || push from notificaciones where tipo = 'RECHAZO' and created_at = now() order by 1;
      rollback;`).filter((f) => f.length === 2 && /^[0-9a-f-]{36}$/.test(f[0]));
    const recibieron = new Map(filas.map(([u, p]) => [u, p]));
    expect(recibieron.has(log), "apagó el aviso").toBe(false);
    expect(recibieron.get(admin), "el Admin, sin celular").toBe("false");
    expect(recibieron.has(ger), "Gerencia no se sumó").toBe(false);
    // Los demás de Logística, como siempre (con celular).
    for (const u of activos("LOGISTICA").filter((x) => x !== log)) expect(recibieron.get(u), u).toBe("true");
  });

  test("en Avisos: cada rol ve los suyos (activos); el Admin ve todos por área (apagados) y elige", async ({ abrir }) => {
    const admin = uidDe("ADMIN");
    try {
      const log = await abrir("logistica", "/avisos");
      await log.getByRole("button", { name: "Elegir avisos" }).click();
      const hojaLog = log.getByRole("dialog", { name: "Elegir avisos" });
      await expect(hojaLog.getByRole("listitem")).toHaveText([/proveedor envió su cotización/, /Tesorería rechazó/, /adicional/, /precio del presupuesto/]);
      for (const s of await hojaLog.getByRole("switch", { name: "Avisar" }).all()) await expect(s).toHaveAttribute("aria-checked", "true");

      const page = await abrir("admin", "/avisos");
      await page.getByRole("button", { name: "Elegir avisos" }).click();
      const hoja = page.getByRole("dialog", { name: "Elegir avisos" });
      await expect(hoja.getByRole("heading", { level: 3 })).toHaveText(["Logística", "Tesorería", "Operaciones"]);
      for (const s of await hoja.getByRole("switch", { name: "Avisar" }).all()) await expect(s).toHaveAttribute("aria-checked", "false");
      // Se suma a «Llegó una orden por pagar»: en la campana, sin celular; luego también al celular.
      const evento = hoja.getByRole("listitem", { name: "Llegó una orden por pagar" });
      await expect(evento.getByRole("switch", { name: "Al celular" })).toBeDisabled();
      await evento.getByRole("switch", { name: "Avisar" }).click();
      await expect.poll(() => sql1(`select avisar || ' ' || celular from aviso_preferencias where user_id = '${admin}' and tipo = 'POR_PAGAR'`)).toBe("true false");
      await evento.getByRole("switch", { name: "Al celular" }).click();
      await expect.poll(() => sql1(`select avisar || ' ' || celular from aviso_preferencias where user_id = '${admin}' and tipo = 'POR_PAGAR'`)).toBe("true true");
      // Se recuerda.
      await page.reload();
      await page.getByRole("button", { name: "Elegir avisos" }).click();
      await expect(page.getByRole("dialog", { name: "Elegir avisos" }).getByRole("listitem", { name: "Llegó una orden por pagar" }).getByRole("switch", { name: "Al celular" })).toHaveAttribute("aria-checked", "true");
      // Apagarlo vuelve al defecto (no queda guardado).
      await page.getByRole("dialog", { name: "Elegir avisos" }).getByRole("listitem", { name: "Llegó una orden por pagar" }).getByRole("switch", { name: "Avisar" }).click();
      await expect.poll(() => sql1(`select count(*) from aviso_preferencias where user_id = '${admin}' and tipo = 'POR_PAGAR'`)).toBe("0");
    } finally {
      sql(`delete from aviso_preferencias where user_id = '${admin}'`);
    }
  });
});
