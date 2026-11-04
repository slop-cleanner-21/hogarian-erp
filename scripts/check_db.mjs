#!/usr/bin/env node
// Validación de migraciones + seeds sin Docker, usando PGlite (Postgres 17 en WASM).
//
// Uso:
//   node scripts/check_db.mjs --pglite-dir <dir con node_modules/@electric-sql/pglite> \
//        [--check-json <json de extract_excel.py --check-json>] [--no-excel]
// También: env PGLITE_DIR, CHECK_JSON. Sale con código 1 si falla alguna aserción.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgliteDir = args['pglite-dir'] ?? process.env.PGLITE_DIR ?? root;
const checkJson = args['check-json'] ?? process.env.CHECK_JSON;
const pgDist = join(pgliteDir, 'node_modules', '@electric-sql', 'pglite', 'dist');
const { PGlite } = await import(pathToFileURL(join(pgDist, 'index.js')).href);
let pgcrypto = null;
try {
  ({ pgcrypto } = await import(pathToFileURL(join(pgDist, 'contrib', 'pgcrypto.js')).href));
} catch {
  console.log('AVISO: pgcrypto no disponible en PGlite; se omite el seed de usuarios auth');
}

const db = new PGlite({ extensions: pgcrypto ? { pgcrypto } : {} });
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const expectError = async (name, fn, pattern) => {
  try {
    await fn();
    check(name, false, 'no lanzó error');
  } catch (e) {
    const ok = !pattern || pattern.test(e.message);
    check(name, ok, e.message);
  }
};
const n = (v) => (v === null || v === undefined ? null : Number(v));
const near = (a, b, tol = 0.005) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) <= tol;

// ------------------------------------------------------------ stubs de Supabase
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin;
  create schema extensions;
  create schema auth;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255) unique,
    encrypted_password varchar(255), email_confirmed_at timestamptz, raw_app_meta_data jsonb,
    raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
    confirmation_token varchar(255), recovery_token varchar(255), email_change varchar(255),
    email_change_token_new varchar(255), email_change_token_current varchar(255) default '',
    last_sign_in_at timestamptz);
  create table auth.identities (
    id uuid primary key default gen_random_uuid(), provider_id text not null,
    user_id uuid not null references auth.users on delete cascade, identity_data jsonb not null,
    provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
    email text generated always as (lower(identity_data->>'email')) stored, unique (provider_id, provider));
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now());
  alter table storage.objects enable row level security;
`);
if (pgcrypto) await db.exec('create extension pgcrypto with schema extensions;');

// ------------------------------------------------------------ migraciones + seeds
const execFile = async (label, sql) => {
  try {
    await db.exec(sql);
  } catch (e) {
    const pos = Number(e.position) || 0;
    const line = pos ? sql.slice(0, pos).split('\n').length : '?';
    console.error(`ERROR en ${label} (línea ~${line}): ${e.message}${e.detail ? ' — ' + e.detail : ''}${e.where ? '\n  ' + e.where : ''}`);
    process.exit(2);
  }
};
const migDir = join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await execFile(f, readFileSync(join(migDir, f), 'utf8'));
  console.log(`migración aplicada: ${f}`);
}
let base = readFileSync(join(root, 'supabase', 'seed', 'base.sql'), 'utf8');
if (!pgcrypto) base = base.replace(/-- -+ usuarios locales[\s\S]*$/, '');
await execFile('base.sql', base);
console.log('seed aplicado: base.sql');
const excelPath = join(root, 'supabase', 'seed', 'excel.sql');
const withExcel = !args['no-excel'] && existsSync(excelPath);
let auditTrasExcel = 0;
if (withExcel) {
  const t0 = Date.now();
  await execFile('excel.sql', readFileSync(excelPath, 'utf8'));
  console.log(`seed aplicado: excel.sql (${Date.now() - t0} ms)`);
  auditTrasExcel = n((await one('select count(*) n from audit_log')).n);
  const tmPath = join(root, 'supabase', 'seed', 'tipo_material.sql');
  if (existsSync(tmPath)) {
    await execFile('tipo_material.sql', readFileSync(tmPath, 'utf8'));
    const ta = n((await one('select count(*) n from audit_log')).n) - auditTrasExcel;
    if (ta) console.log(`AVISO: tipo_material.sql generó ${ta} filas en audit_log (no fija app.skip_audit)`);
    const tm = await rows(`select coalesce(tipo_material, '(sin tipo)') t, count(*) n from items group by 1 order by 1`);
    console.log('seed aplicado: tipo_material.sql —', tm.map((r) => `${r.t}=${r.n}`).join(', '));
  } else {
    console.log('(tipo_material.sql no existe todavía; se omite)');
  }
}

// ------------------------------------------------------------ conteos
const counts = await one(`select
  (select count(*) from empresas) empresas, (select count(*) from obras) obras,
  (select count(*) from items) items, (select count(*) from proveedores) proveedores,
  (select count(*) from partidas) partidas, (select count(*) from ordenes_compra) ordenes,
  (select count(*) from oc_items) oc_items, (select count(*) from comprobantes) comprobantes,
  (select count(*) from pagos) pagos, (select count(*) from pago_aplicaciones) aplicaciones,
  (select count(*) from cuentas_contables) cuentas, (select count(*) from perfiles) perfiles,
  (select count(*) from auth.users) users, (select count(*) from audit_log) audit`);
console.log('conteos:', Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, n(v)])));
if (pgcrypto) check('usuarios auth + perfiles (9 de base.sql)', n(counts.users) === 9 && n(counts.perfiles) === 9, `users=${counts.users} perfiles=${counts.perfiles}`);
check('audit_log vacío tras base.sql + excel.sql (app.skip_audit)', auditTrasExcel === 0, `audit=${auditTrasExcel}`);
const auditMax = async () => n((await one('select coalesce(max(id), 0) m from audit_log')).m);
const auditSeedMax = await auditMax();
check('tipos_material sembrados en la migración (5)', n((await one('select count(*) n from tipos_material')).n) === 5);
check('bucket comprobantes privado', (await one(`select public from storage.buckets where id='comprobantes'`))?.public === false);

if (withExcel) {
  check('items ≈ 671', n(counts.items) >= 671, `items=${counts.items}`);
  check('proveedores ≈ 265 - 8 duplicados + stubs', n(counts.proveedores) >= 257, `proveedores=${counts.proveedores}`);
  const pc = await one(`select count(*) n, count(*) filter (where p.id is null) huerfanas from proveedor_cuentas c left join proveedores p on p.id = c.proveedor_id`);
  check('proveedor_cuentas sembradas desde el Excel (banco o cuenta)', n(pc.n) > 0 && n(pc.huerfanas) === 0, `proveedor_cuentas=${pc.n}`);
  check('partidas = 5686', n(counts.partidas) === 5686);
  check('oc_items = líneas válidas de GASTOEJEC (3475 - 1 cant 0)', n(counts.oc_items) === 3474, `oc_items=${counts.oc_items}`);
  check('obras = 14', n(counts.obras) === 14);

  // ---------------------------------------------------------- v_partidas
  const g1 = await one(`select * from v_partidas where codigo='G1'`);
  check('G1 cantidad 226', near(g1.cantidad, 226));
  check('G1 cant_comprometida 198', near(g1.cant_comprometida, 198));
  check('G1 saldo_cant 28', near(g1.saldo_cant, 28));
  check('G1 monto_ejecutado 891', near(g1.monto_ejecutado, 891), `monto=${g1.monto_ejecutado}`);
  const g2 = await one(`select * from v_partidas where codigo='G2'`);
  check('G2 saldo_cant 0', near(g2.saldo_cant, 0));

  if (checkJson && existsSync(checkJson)) {
    const ex = JSON.parse(readFileSync(checkJson, 'utf8'));
    const vp = await rows(`select codigo, cant_comprometida, monto_ejecutado from v_partidas`);
    let mq = 0, mr = 0;
    const exq = [], exr = [];
    for (const r of vp) {
      const e = ex[r.codigo];
      if (!e) continue;
      if (e.q !== null && !near(r.cant_comprometida, e.q, 0.0001)) { mq++; exq.push(`${r.codigo}: db=${r.cant_comprometida} xl=${e.q}`); }
      if (e.r !== null && !near(r.monto_ejecutado, e.r, 0.05)) { mr++; exr.push(`${r.codigo}: db=${r.monto_ejecutado} xl=${e.r}`); }
    }
    const tot = await one(`select sum(monto_ejecutado) m, sum(cant_comprometida) c from v_partidas`);
    const xlTot = Object.values(ex).reduce((s, e) => s + (e.r ?? 0), 0);
    console.log(`  comparación con GASTOPROG Q/R (${vp.length} partidas): cant≠ ${mq}, monto≠ ${mr} (tol 0.05)`);
    console.log(`  total monto_ejecutado db=${n(tot.m).toFixed(2)} excel=${xlTot.toFixed(2)}`);
    if (exq.length) console.log('   cant:', exq.slice(0, 10).join(' | '));
    if (exr.length) console.log('   monto:', exr.slice(0, 15).join(' | '));
    check('cant_comprometida = GASTOPROG Q (todas)', mq <= 1, `${mq} diferencias`);
    check('monto_ejecutado ≈ GASTOPROG R', mr <= 10, `${mr} diferencias`);
  } else {
    console.log('  (sin --check-json: se omite la comparación con GASTOPROG Q/R)');
  }

  // ---------------------------------------------------------- consistencia del seed
  const est = await rows(`select estado, count(*) n, count(*) filter (where pagado < total - 0.005) no_cubiertas
                            from v_ordenes group by estado order by 1`);
  console.log('  v_ordenes por estado:', est.map((r) => `${r.estado}=${r.n} (no cubiertas ${r.no_cubiertas})`).join(', '));
  const pend = await rows(`select origen, count(*) n, sum(saldo) saldo from v_pendientes_pago group by origen`);
  console.log('  v_pendientes_pago:', pend.map((r) => `${r.origen}=${r.n} saldo ${n(r.saldo).toFixed(2)}`).join(', '));
  const cmp = await one(`select count(*) n, sum(total) t, sum(base) b, sum(igv) i from comprobantes`);
  console.log(`  comprobantes total=${cmp.t} base=${cmp.b} igv=${cmp.i}`);
  const hist = await one(`select count(*) n from v_precio_historico_item`);
  check('v_precio_historico_item con datos', n(hist.n) > 100, `${hist.n} ítems`);
  const sig = await rows(`select o.nombre, siguiente_numero_oc(o.id) s from obras o order by 1`);
  console.log('  siguiente_numero_oc:', sig.map((r) => `${r.nombre}=${r.s}`).join(', '));
  const sinc = await one(`select count(*) n from v_items_sin_cuenta`);
  console.log(`  v_items_sin_cuenta: ${sinc.n}; v_registro_compras: ${(await one('select count(*) n from v_registro_compras')).n}`);
}

// ------------------------------------------------------------ PostgREST: FKs para embeds sin ambigüedad
const fk = await rows(`select conrelid::regclass::text src, confrelid::regclass::text dst, count(*) n
                         from pg_constraint where contype='f' and connamespace='public'::regnamespace
                        group by 1,2`);
const fkn = (s, d) => n(fk.find((r) => r.src === s && r.dst === d)?.n ?? 0);
check('FK únicas para embeds (pago_aplicaciones→ordenes_compra/comprobantes/pagos, asientos→pagos, *→proveedores)',
  fkn('pago_aplicaciones', 'ordenes_compra') === 1 && fkn('pago_aplicaciones', 'comprobantes') === 1 &&
  fkn('pago_aplicaciones', 'pagos') === 1 && fkn('asientos', 'pagos') === 1 &&
  fkn('ordenes_compra', 'proveedores') === 1 && fkn('comprobantes', 'proveedores') === 1);

// ------------------------------------------------------------ datos de prueba propios
// Obra/partidas nuevas para que el flujo no dependa del Excel.
await db.exec(`
  insert into empresas (nombre, ruc) values ('EMPRESA TEST', '20000000001'), ('OTRA TEST', '20000000002');
  insert into obras (nombre, empresa_id) select 'OBRA TEST', id from empresas where nombre = 'EMPRESA TEST';
  insert into obras (nombre, empresa_id) select 'OBRA TEST 2', id from empresas where nombre = 'OTRA TEST';
  insert into items (descripcion, unidad, rubro, tolerancia_pct) values
    ('ITEM TEST CEMENTO', 'BLS', 'MATERIAL', 0.05), ('ITEM TEST ARENA', 'M3', 'MATERIAL', 0),
    ('ITEM TEST HONORARIO', 'GLB', 'LOCACION', 0), ('ITEM TEST MO', 'M2', 'MANO OBRA', 0);
  insert into proveedores (ruc_o_cod, razon_social, comprobante_habitual)
    values ('20999999991', 'PROVEEDOR TEST SAC', 'FACTURA'), ('10999999992', 'PERSONA TEST', 'RXH');
  insert into proveedor_cuentas (proveedor_id, banco, cuenta_bancaria)
  select id, x.banco, x.cuenta from proveedores
    join (values ('20999999991', 'BBVA', '0011-TEST'), ('10999999992', 'BCP', '191-TEST')) x(ruc, banco, cuenta) on x.ruc = ruc_o_cod;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
  select o.id, 'L0', 'REGULAR', i.id, 100, x.pu
    from obras o, items i join (values ('ITEM TEST CEMENTO', 30.0), ('ITEM TEST ARENA', 50.0), ('ITEM TEST HONORARIO', 2000.0), ('ITEM TEST MO', 20.0)) x(d, pu) on x.d = i.descripcion
   where o.nombre = 'OBRA TEST';
  insert into partidas (obra_id, etapa, item_id, cantidad, pu)
  select o.id, 'L0', i.id, 10, 30 from obras o, items i where o.nombre = 'OBRA TEST 2' and i.descripcion = 'ITEM TEST CEMENTO';
`);
const ids = await one(`select
  (select id from obras where nombre='OBRA TEST') obra, (select id from obras where nombre='OBRA TEST 2') obra2,
  (select id from empresas where nombre='EMPRESA TEST') empresa,
  (select id from proveedores where ruc_o_cod='20999999991') prov, (select id from proveedores where ruc_o_cod='10999999992') prov_rxh,
  (select p.id from partidas p join items i on i.id=p.item_id join obras o on o.id=p.obra_id where o.nombre='OBRA TEST' and i.descripcion='ITEM TEST CEMENTO') p_cem,
  (select p.id from partidas p join items i on i.id=p.item_id join obras o on o.id=p.obra_id where o.nombre='OBRA TEST' and i.descripcion='ITEM TEST ARENA') p_are,
  (select p.id from partidas p join items i on i.id=p.item_id join obras o on o.id=p.obra_id where o.nombre='OBRA TEST' and i.descripcion='ITEM TEST HONORARIO') p_hon,
  (select p.id from partidas p join items i on i.id=p.item_id join obras o on o.id=p.obra_id where o.nombre='OBRA TEST' and i.descripcion='ITEM TEST MO') p_mo,
  (select p.id from partidas p join obras o on o.id=p.obra_id where o.nombre='OBRA TEST 2') p_otra,
  (select id from items where descripcion='ITEM TEST CEMENTO') i_cem, (select id from items where descripcion='ITEM TEST ARENA') i_are,
  (select id from items where descripcion='ITEM TEST HONORARIO') i_hon`);
// Usuarios de base.sql: cada paso se hace con el rol que lo hace en la app.
const LOG = 'a0000000-0000-4000-8000-000000000001';
const CON = 'a0000000-0000-4000-8000-000000000002';
const TES = 'a0000000-0000-4000-8000-000000000003';
const UID = LOG;

// sesión como usuario autenticado (RLS + grants reales). Con request.jwt.claim.role = authenticated,
// exigir_rol() y rol_actual() validan el rol del perfil como lo harían por la API.
const asUser = async (uid = LOG) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false);
                 select set_config('request.jwt.claim.role', '${pgcrypto ? 'authenticated' : ''}', false); set role authenticated;`);
};
// Como seeds y cargas: superusuario sin sesión de la API.
const asSuper = async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claims', '', false);`);
};
const asAnon = async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);
                 select set_config('request.jwt.claim.role', 'anon', false); set role anon;`);
};
await asUser();

check('siguiente_numero_oc de obra nueva = 100001',
  (await one(`select siguiente_numero_oc($1) n`, [ids.obra])).n === '100001');

// FK compuesta: partida de otra obra (como superusuario: por la API nadie escribe órdenes directo)
await db.exec('reset role');
await db.exec(`insert into ordenes_compra (obra_id, numero, proveedor_id, estado) values (${ids.obra}, 'FKTEST', ${ids.prov}, 'BORRADOR')`);
await expectError('FK: oc_item con partida de otra obra es rechazado',
  () => db.query(`insert into oc_items (obra_id, numero_oc, partida_id, cantidad) values ($1, 'FKTEST', $2, 1)`, [ids.obra, ids.p_otra]),
  /foreign key|llave foránea|violates/i);
await db.exec(`delete from ordenes_compra where obra_id=${ids.obra} and numero='FKTEST'`);
await asUser();

// crear_orden con cantidad > saldo
await expectError('crear_orden con cantidad > saldo falla',
  () => db.query(`select crear_orden($1, null, $2, 'OC', $3::jsonb)`, [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_cem, cantidad: 101 }])]),
  /excede su saldo/);
await expectError('crear_orden con partida de otra obra falla',
  () => db.query(`select crear_orden($1, null, $2, 'OC', $3::jsonb)`, [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_otra, cantidad: 1 }])]),
  /no pertenece a la obra/);
await expectError('crear_orden con partida de mano de obra falla (va por valorización)',
  () => db.query(`select crear_orden($1, null, $2, 'OS', $3::jsonb)`, [ids.obra, ids.prov_rxh, JSON.stringify([{ partida_id: ids.p_mo, cantidad: 1 }])]),
  /desde una valorización/);
await asUser(CON);
await expectError('crear_orden con rol CONTABILIDAD falla (exigir_rol)',
  () => db.query(`select crear_orden($1, null, $2, 'OC', $3::jsonb)`, [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_cem, cantidad: 1 }])]),
  /No tienes permiso/);
await asUser(LOG);
if (withExcel) {
  const g1 = await one(`select p.id, p.obra_id from partidas p where codigo='G1'`);
  await expectError('crear_orden sobre G1 (saldo 28) con 29 falla',
    () => db.query(`select crear_orden($1, null, $2, 'OC', $3::jsonb)`, [g1.obra_id, ids.prov, JSON.stringify([{ partida_id: g1.id, cantidad: 29 }])]),
    /excede su saldo disponible \(28\)/);
}

// ------------------------------------------------------------ happy path completo
const numero = (await one(`select crear_orden($1, null, $2, 'OC', $3::jsonb) n`,
  [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_cem, cantidad: 10 }, { partida_id: ids.p_are, cantidad: 2 }])])).n;
check('crear_orden devuelve 100001', numero === '100001', numero);
let ord = await one(`select * from ordenes_compra where obra_id=$1 and numero=$2`, [ids.obra, numero]);
check('orden EMITIDA con fecha de hoy', ord.estado === 'EMITIDA');
await expectError('crear_orden con número duplicado falla',
  () => db.query(`select crear_orden($1, $2, $3, 'OC', $4::jsonb)`, [ids.obra, numero, ids.prov, JSON.stringify([{ partida_id: ids.p_are, cantidad: 1 }])]),
  /Ya existe la orden/);
const saldoCem = await one(`select saldo_cant from v_partidas where id=$1`, [ids.p_cem]);
check('v_partidas descuenta lo comprometido (saldo 90)', near(saldoCem.saldo_cant, 90));

// anon: solo RPC de cotización (el link se abre una vez que Logística lo envía)
await db.query(`select marcar_cotizacion_enviada($1, $2)`, [ids.obra, numero]);
await db.exec('reset role');
const auditAntesAnon = await auditMax();
await asAnon();
await expectError('anon no puede leer tablas', () => db.query(`select count(*) from items`), /permission denied|permiso denegado/);
await expectError('anon no puede ejecutar crear_orden',
  () => db.query(`select crear_orden(1, null, 1, 'OC', '[]'::jsonb)`), /permission denied|permiso denegado/);
const cot = (await one(`select get_cotizacion($1) c`, [ord.token_cotizacion])).c;
check('get_cotizacion (anon) devuelve cabecera e ítems sin precios de presupuesto',
  cot.numero === numero && cot.items.length === 2 && !('pu_max' in cot.items[0]) && !('pu' in cot.items[0]),
  JSON.stringify(cot).slice(0, 160));
const lineCem = cot.items.find((i) => i.descripcion === 'ITEM TEST CEMENTO');
const lineAre = cot.items.find((i) => i.descripcion === 'ITEM TEST ARENA');
await db.query(`select enviar_cotizacion($1, $2::jsonb)`,
  [ord.token_cotizacion, JSON.stringify([{ item_id: lineCem.id, pu: 35 }, { item_id: lineAre.id, pu: 50 }])]); // 35 > 31.5
check('enviar_cotizacion (anon) guarda precios', true);
await expectError('enviar_cotizacion con token inválido falla',
  () => db.query(`select enviar_cotizacion(gen_random_uuid(), '[]'::jsonb)`), /ya no está disponible/);

await db.exec('reset role');
const auditTrasAnon = await auditMax();
await asUser();
const vl = await rows(`select * from v_oc_items where obra_id=$1 and numero_oc=$2 order by id`, [ids.obra, numero]);
check('v_oc_items marca SOBREPRECIO (35 > 31.5)', vl[0].alerta === 'SOBREPRECIO' && vl[0].pu_efectivo === null && near(vl[0].pu_max, 31.5),
  `alerta=${vl[0].alerta} pu_max=${vl[0].pu_max} dif=${vl[0].dif}`);
check('v_ordenes.has_alertas', (await one(`select has_alertas from v_ordenes where obra_id=$1 and numero=$2`, [ids.obra, numero])).has_alertas === true);
await expectError('confirmar_precios con sobreprecio sin aprobar falla',
  () => db.query(`select confirmar_precios($1, $2)`, [ids.obra, numero]), /superan el precio máximo/);
await db.query(`select guardar_precios($1, $2, $3::jsonb)`,
  [ids.obra, numero, JSON.stringify([{ item_id: lineCem.id, pu: 35, pu_aprobado: 35 }])]);
const ap = await one(`select pu_aprobado, aprobado_por from oc_items where id=$1`, [lineCem.id]);
check('guardar_precios aprueba sobreprecio con aprobado_por = auth.uid()', near(ap.pu_aprobado, 35) && ap.aprobado_por === UID);
await db.query(`select confirmar_precios($1, $2)`, [ids.obra, numero]);
let vo = await one(`select * from v_ordenes where obra_id=$1 and numero=$2`, [ids.obra, numero]);
check('confirmar_precios -> PRECIOS_CONFIRMADOS, total 450', vo.estado === 'PRECIOS_CONFIRMADOS' && near(vo.total, 450) && !vo.has_alertas,
  `estado=${vo.estado} total=${vo.total}`);
check('v_pendientes_pago muestra la orden sin comprobante (FALTA)',
  !!(await one(`select 1 x from v_pendientes_pago where origen='ORDEN' and obra_id=$1 and numero_oc=$2`, [ids.obra, numero])));
await expectError('guardar_precios tras confirmar falla',
  () => db.query(`select guardar_precios($1, $2, '[]'::jsonb)`, [ids.obra, numero]), /EMITIDAS/);

const compId = n((await one(`select registrar_comprobante($1, 'FACTURA', 'f001', '000123', current_date, 450, 0, 'test/f001-123.pdf', $2::bigint[]) id`,
  [ids.prov, [lineCem.id, lineAre.id]])).id);
const comp = await one(`select * from comprobantes where id=$1`, [compId]);
check('registrar_comprobante: serie/numero normalizados, base/igv', comp.serie === 'F001' && comp.numero === '123' &&
  near(comp.base, 381.36) && near(comp.igv, 68.64), `base=${comp.base} igv=${comp.igv}`);
vo = await one(`select * from v_ordenes where obra_id=$1 and numero=$2`, [ids.obra, numero]);
check('orden -> FACTURADA, facturado 450', vo.estado === 'FACTURADA' && near(vo.facturado, 450));
await expectError('registrar_comprobante duplicado / ítems ya facturados falla',
  () => db.query(`select registrar_comprobante($1, 'FACTURA', 'F001', '124', current_date, 450, 0, null, $2::bigint[])`, [ids.prov, [lineCem.id]]),
  /ya tienen comprobante/);
// Contabilidad: cuentas de clase 9 por ítem y asiento de compra con sus amarres.
await asUser(CON);
await expectError('contabilizar_comprobante sin cuentas falla',
  () => db.query(`select contabilizar_comprobante($1)`, [compId]), /sin cuenta contable/);
const sinCuenta = await one(`select items_sin_cuenta from v_registro_compras where comprobante_id=$1`, [compId]);
check('v_registro_compras.items_sin_cuenta = 2', n(sinCuenta.items_sin_cuenta) === 2);
await db.query(`select asignar_cuenta_item($1, '91211010101')`, [ids.i_cem]);
await db.query(`select asignar_cuenta_item($1, '912110101')`, [ids.i_are]);
await expectError('asignar_cuenta_item con cuenta inexistente falla',
  () => db.query(`select asignar_cuenta_item($1, '999999')`, [ids.i_are]), /no existe/);
await expectError('asignar_cuenta_item con cuenta que no es de clase 9 falla',
  () => db.query(`select asignar_cuenta_item($1, '6032')`, [ids.i_are]), /clase 9/);
const asC = n((await one(`select contabilizar_comprobante($1) id`, [compId])).id);
const linC = await rows(`select cuenta, debe, haber from asiento_lineas where asiento_id=$1 and not amarre order by orden`, [asC]);
const amC = await rows(`select cuenta, debe, haber from asiento_lineas where asiento_id=$1 and amarre order by orden`, [asC]);
const sum = (ls, k) => ls.reduce((s, l) => s + Number(l[k]), 0);
const fmt = (ls) => ls.map((l) => `${l.cuenta} ${l.debe}/${l.haber}`).join(', ');
const tiene = (ls, cuenta, k, v) => ls.some((l) => l.cuenta === cuenta && near(l[k], v));
check('asiento de compra cuadrado (Debe 91211010101+912110101+961110102 = Haber 421210101 = 450)',
  near(sum(linC, 'debe'), 450) && near(sum(linC, 'haber'), 450) &&
  tiene(linC, '91211010101', 'debe', 296.61) && tiene(linC, '912110101', 'debe', 84.75) &&
  tiene(linC, '961110102', 'debe', 68.64) && tiene(linC, '421210101', 'haber', 450), fmt(linC));
check('amarres del asiento de compra (602101/791110101, 602410106/791110101 → 244110106/612410106, 641110101/7911101)',
  amC.length === 8 && near(sum(amC, 'debe'), sum(amC, 'haber')) &&
  tiene(amC, '602101', 'debe', 296.61) && tiene(amC, '602410106', 'debe', 84.75) && tiene(amC, '244110106', 'debe', 84.75) &&
  tiene(amC, '612410106', 'haber', 84.75) && tiene(amC, '641110101', 'debe', 68.64) && tiene(amC, '7911101', 'haber', 68.64) &&
  near(sum(amC.filter((l) => l.cuenta === '791110101'), 'haber'), 381.36), fmt(amC));
await expectError('contabilizar_comprobante dos veces falla',
  () => db.query(`select contabilizar_comprobante($1)`, [compId]), /ya está contabilizado/);
await expectError('cambiar_destino_igv de una factura contabilizada falla',
  () => db.query(`select cambiar_destino_igv($1, 'DNG')`, [compId]), /ya está contabilizada/);

// Tesorería: solo paga lo que Logística le envió (pagar_documento, con voucher).
const pagar = (obra, num, monto, op) => db.query(
  `select pagar_documento($1, $2, null, current_date, 'BBVA', $3, $4, $5, null) id`, [obra, num, op, monto, `pagos/test-${op}.pdf`]);
await asUser(TES);
await expectError('pagar_documento antes de enviar a Tesorería falla',
  () => pagar(ids.obra, numero, 100, 'OP-0'), /no está en Tesorería/);
await asUser(LOG);
await db.query(`select enviar_a_tesoreria($1, $2)`, [ids.obra, numero]);
check('enviar_a_tesoreria -> EN_TESORERIA',
  (await one(`select estado from ordenes_compra where obra_id=$1 and numero=$2`, [ids.obra, numero])).estado === 'EN_TESORERIA');
await expectError('pagar_documento con rol LOGISTICA falla (exigir_rol)',
  () => pagar(ids.obra, numero, 100, 'OP-L'), /No tienes permiso/);
await asUser(TES);
await expectError('registrar_pago no se ejecuta por la API (solo seeds y cargas)',
  () => db.query(`select registrar_pago($1, current_date, 'BBVA', 'OP-X', $2::jsonb)`, [ids.empresa, JSON.stringify([{ comprobante_id: compId, monto: 1 }])]),
  /permission denied|permiso denegado/);
await asSuper();
await expectError('registrar_pago por encima del saldo falla',
  () => db.query(`select registrar_pago($1, current_date, 'BBVA', 'OP-X', $2::jsonb)`, [ids.empresa, JSON.stringify([{ comprobante_id: compId, monto: 451 }])]),
  /excede el saldo/);
await asUser(TES);
await expectError('pagar_documento por encima del saldo falla',
  () => pagar(ids.obra, numero, 451, 'OP-X'), /excede el saldo por pagar/);
const pago1 = n((await pagar(ids.obra, numero, 200, 'OP-1')).rows[0].id);
vo = await one(`select * from v_ordenes where obra_id=$1 and numero=$2`, [ids.obra, numero]);
check('pago parcial: orden sigue EN_TESORERIA, pagado 200', vo.estado === 'EN_TESORERIA' && near(vo.pagado, 200), `estado=${vo.estado} pagado=${vo.pagado}`);
const pago2 = n((await pagar(ids.obra, numero, 250, 'OP-2')).rows[0].id);
vo = await one(`select * from v_ordenes where obra_id=$1 and numero=$2`, [ids.obra, numero]);
check('pago total: orden -> PAGADA', vo.estado === 'PAGADA' && near(vo.pagado, 450), `estado=${vo.estado} pagado=${vo.pagado}`);
check('comprobante sale de v_pendientes_pago',
  !(await one(`select 1 x from v_pendientes_pago where comprobante_id=$1`, [compId])));
await asUser(CON);
const asP = n((await one(`select contabilizar_pago($1) id`, [pago2])).id);
const linP = await rows(`select cuenta, debe, haber from asiento_lineas where asiento_id=$1 order by cuenta`, [asP]);
check('asiento de pago cuadrado (Debe 421210101 / Haber 1041)',
  linP.length === 2 && tiene(linP, '421210101', 'debe', 250) && tiene(linP, '1041', 'haber', 250), fmt(linP));
await db.query(`select contabilizar_pago($1)`, [pago1]);
await asUser(LOG);
await expectError('anular_orden con comprobante/pagos falla',
  () => db.query(`select anular_orden($1, $2, 'x')`, [ids.obra, numero]), /No se puede anular/);

// OS con RxH y retención: contrato firmado obligatorio, se paga el neto.
const nRxh = (await one(`select crear_orden($1, null, $2, 'OS', $3::jsonb) n`,
  [ids.obra, ids.prov_rxh, JSON.stringify([{ partida_id: ids.p_hon, cantidad: 1 }])])).n;
check('siguiente número = 100002', nRxh === '100002', nRxh);
const lHon = await one(`select id, pu_cotizado from oc_items where obra_id=$1 and numero_oc=$2`, [ids.obra, nRxh]);
check('OS nace con el P.U. del presupuesto', near(lHon.pu_cotizado, 2000), `pu_cotizado=${lHon.pu_cotizado}`);
await db.query(`select guardar_precios($1, $2, $3::jsonb)`, [ids.obra, nRxh, JSON.stringify([{ item_id: lHon.id, pu: 2000 }])]);
await db.query(`select confirmar_precios($1, $2)`, [ids.obra, nRxh]);
const cRxh = n((await one(`select registrar_comprobante($1, 'RXH', 'E001', '7', current_date, 2000, 160, null, $2::bigint[]) id`, [ids.prov_rxh, [lHon.id]])).id);
await expectError('enviar_a_tesoreria de una OS sin contrato firmado falla',
  () => db.query(`select enviar_a_tesoreria($1, $2)`, [ids.obra, nRxh]), /Falta el contrato/);
await db.query(`insert into adjuntos (tipo, obra_id, numero_oc, path, nombre, mime) values ('CONTRATO', $1, $2, $3, 'contrato.pdf', 'application/pdf')`,
  [ids.obra, nRxh, `${ids.obra}/${nRxh}/contrato.pdf`]);
await db.query(`select enviar_a_tesoreria($1, $2)`, [ids.obra, nRxh]);
await asUser(CON);
await db.query(`select asignar_cuenta_item($1, '911220329')`, [ids.i_hon]);
const asR = n((await one(`select contabilizar_comprobante($1) id`, [cRxh])).id);
const linR = await rows(`select cuenta, debe, haber from asiento_lineas where asiento_id=$1 and not amarre order by orden`, [asR]);
check('asiento RxH: Debe 911220329 2000 / Haber 424110101 1840 + 401720101 160',
  linR.length === 3 && tiene(linR, '911220329', 'debe', 2000) && tiene(linR, '424110101', 'haber', 1840) &&
  tiene(linR, '401720101', 'haber', 160), fmt(linR));
await asUser(TES);
await expectError('pagar_documento de la OS por el bruto falla (se paga el neto de retención)',
  () => pagar(ids.obra, nRxh, 2000, 'OP-3X'), /excede el saldo por pagar \(1840/);
const pR = n((await pagar(ids.obra, nRxh, 1840, 'OP-3')).rows[0].id);
check('RxH pagado neto de retención -> orden PAGADA',
  (await one(`select estado from ordenes_compra where obra_id=$1 and numero=$2`, [ids.obra, nRxh])).estado === 'PAGADA');
await asUser(CON);
const asPR = n((await one(`select contabilizar_pago($1) id`, [pR])).id);
check('asiento pago RxH usa 424110101', !!(await one(`select 1 x from asiento_lineas where asiento_id=$1 and cuenta='424110101' and debe=1840`, [asPR])));

// Orden sin comprobante: figura como pendiente, pero Tesorería no la paga hasta que llegue con su comprobante.
await asUser(LOG);
const nDir = (await one(`select crear_orden($1, 'OS-DIR', $2, 'OC', $3::jsonb) n`,
  [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_are, cantidad: 3 }])])).n;
const lDir = (await one(`select id from oc_items where obra_id=$1 and numero_oc=$2`, [ids.obra, nDir])).id;
await db.query(`select guardar_precios($1, $2, $3::jsonb)`, [ids.obra, nDir, JSON.stringify([{ item_id: lDir, pu: 40 }])]);
await db.query(`select confirmar_precios($1, $2)`, [ids.obra, nDir]);
const pend = await one(`select * from v_pendientes_pago where origen='ORDEN' and obra_id=$1 and numero_oc=$2`, [ids.obra, nDir]);
check('v_pendientes_pago: fila por orden sin comprobante (total 120)', pend && near(pend.saldo, 120) && pend.comprobante_id === null);
await asSuper();
await expectError('registrar_pago directo a orden fuera de Tesorería falla',
  () => db.query(`select registrar_pago($1, current_date, 'BBVA', 'OP-4X', $2::jsonb)`,
    [ids.empresa, JSON.stringify([{ obra_id: ids.obra, numero_oc: nDir, monto: 120 }])]),
  /no está en Tesorería/);
await asUser(TES);
await asUser(LOG);
await db.query(`select registrar_comprobante($1, 'BOLETA', 'B001', '55', current_date, 120, 0, null, $2::bigint[])`, [ids.prov, [lDir]]);
await db.query(`select enviar_a_tesoreria($1, $2)`, [ids.obra, nDir]);
await asUser(TES);
const pD = n((await pagar(ids.obra, nDir, 120, 'OP-4')).rows[0].id);
check('orden con boleta pagada -> PAGADA',
  (await one(`select estado from ordenes_compra where obra_id=$1 and numero=$2`, [ids.obra, nDir])).estado === 'PAGADA');
await asUser(CON);
const asD = n((await one(`select contabilizar_pago($1) id`, [pD])).id);
check('asiento pago de la boleta (421210101/1041) cuadrado',
  near((await one(`select sum(debe)-sum(haber) d from asiento_lineas where asiento_id=$1`, [asD])).d, 0));
await asUser(LOG);

const nAn = (await one(`select crear_orden($1, null, $2, 'OC', $3::jsonb) n`,
  [ids.obra, ids.prov, JSON.stringify([{ partida_id: ids.p_cem, cantidad: 90 }])])).n;
await expectError('anular_orden sin motivo falla', () => db.query(`select anular_orden($1, $2, ' ')`, [ids.obra, nAn]), /motivo/);
await db.query(`select anular_orden($1, $2, 'Prueba')`, [ids.obra, nAn]);
check('anular_orden libera saldo de la partida',
  near((await one(`select saldo_cant from v_partidas where id=$1`, [ids.p_cem])).saldo_cant, 90));

await db.query(`update items set tipo_material = 'CEMENTO' where id = $1`, [ids.i_cem]);
check('tipo_material visible en v_partidas y v_oc_items',
  (await one(`select tipo_material from v_partidas where id=$1`, [ids.p_cem])).tipo_material === 'CEMENTO' &&
  (await one(`select tipo_material from v_oc_items where id=$1`, [lineCem.id])).tipo_material === 'CEMENTO');
await expectError('tipo_material inexistente es rechazado (FK)',
  () => db.query(`update items set tipo_material = 'MADERA' where id = $1`, [ids.i_cem]), /foreign key|violates/i);
await expectError('authenticated no puede borrar audit_log', () => db.query(`delete from audit_log`), /permission denied|permiso denegado/);
check('audit_log no es legible fuera de ADMIN (lectura_por_rol)',
  n((await one(`select count(*) n from audit_log`)).n) === 0);

// Inspección final como superusuario (audit_log y asiento_lineas tienen lectura por rol).
await db.exec('reset role');
// Lo que hace el proveedor por el link (anon: precios en oc_items y cotización RECIBIDA en la orden) va sin
// user_id; todo lo demás, con el del usuario que lo hizo.
const aud = await rows(`select tabla, accion, count(*) n, count(*) filter (where user_id is not null) con_uid,
                               count(*) filter (where id > $2 and id <= $3) anon from audit_log
                         where id > $1 group by 1,2 order by 1,2`, [auditSeedMax, auditAntesAnon, auditTrasAnon]);
console.log('  audit_log:', aud.map((r) => `${r.tabla}.${r.accion}=${r.n}${n(r.anon) ? ` (anon ${r.anon})` : ''}`).join(', '));
const audUsers = await rows(`select distinct user_id from audit_log where id > $1 and user_id is not null`, [auditSeedMax]);
const audAnon = await one(`select count(*) filter (where user_id is null) sin_uid, count(*) n from audit_log where id > $1 and id <= $2`,
  [auditAntesAnon, auditTrasAnon]);
check('audit_log registra cambios con user_id (excepto anon)', aud.length > 5 &&
  aud.every((r) => n(r.con_uid) === n(r.n) - n(r.anon)) && n(audAnon.n) > 0 && n(audAnon.sin_uid) === n(audAnon.n) &&
  aud.some((r) => r.tabla === 'items' && r.accion === 'UPDATE') &&
  [LOG, CON, TES].every((u) => audUsers.some((r) => r.user_id === u)),
  `usuarios=${audUsers.map((r) => r.user_id.slice(-1)).join(',')}`);
const desc = await one(`select count(*) n from (select asiento_id from asiento_lineas group by 1 having sum(debe) <> sum(haber)) x`);
check('todos los asientos cuadran', n(desc.n) === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ' — FALLAN: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);
