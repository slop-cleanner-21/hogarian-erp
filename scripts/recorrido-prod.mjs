// El recorrido completo (tests/e2e/flujo.spec.ts) contra producción, de una obra nueva al pago, y limpieza total.
//   npm run test:prod                 corre el recorrido y limpia
//   npm run test:prod -- --limpiar    solo limpia (si una corrida anterior se cortó)
//
// No usa las cuentas reales: crea cuentas temporales e2e.<rol>@hogarian.test con una contraseña al azar (no se muestra
// ni se guarda) y las borra al final. Lo que crea el recorrido lleva «E2E» en el nombre. La limpieza corre aunque el
// recorrido falle, y al final compara las filas de todas las tablas con las de antes: si algo quedó, lo dice y falla.
// Lo que reciben los usuarios reales mientras corre: avisos en la campana (se borran al limpiar).
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL_DB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRETA = process.env.SUPABASE_SECRET_KEY;
const CLAVE_DB = process.env.SUPABASE_DB_PASSWORD;
const BASE = process.env.BASE ?? "https://hogarian-erp.vercel.app";
if (!URL_DB?.includes(".supabase.co") || !SECRETA || !CLAVE_DB) {
  console.error("Falta .env.produccion.local: npm run test:prod");
  process.exit(2);
}
const ref = new URL(URL_DB).hostname.split(".")[0];
const CONEXION = `host=aws-1-sa-east-1.pooler.supabase.com port=5432 user=postgres.${ref} dbname=postgres sslmode=require`;
const SESIONES = path.resolve("tests/e2e/.auth/prod");

const CUENTAS = [
  { clave: "gerencia", rol: "GERENCIA", nombres: "Gerencia" },
  { clave: "logistica", rol: "LOGISTICA", nombres: "E2E Logística" },
  { clave: "tesoreria", rol: "TESORERIA", nombres: "E2E Tesorería" },
  { clave: "jefe", rol: "JEFE_OPERACIONES", nombres: "E2E Jefe" },
  { clave: "admin", rol: "ADMIN", nombres: "E2E Admin" },
].map((c) => ({ ...c, email: `e2e.${c.clave}@hogarian.test` }));
const esTemporal = (email) => /^e2e\.[a-z]+@hogarian\.test$/.test(email ?? "");

const db = createClient(URL_DB, SECRETA, { auth: { persistSession: false, autoRefreshToken: false } });

function psql(script) {
  return execFileSync(
    "docker",
    ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "-e", "PGPASSWORD", "supabase_db_erp-prod1", "psql", CONEXION, "-At", "-q", "-F", "|", "-v", "ON_ERROR_STOP=1"],
    { input: script, encoding: "utf8", env: { ...process.env, PGPASSWORD: CLAVE_DB } },
  ).trim();
}

/** Las filas de cada tabla (exactas), para comparar antes y después. */
function filasPorTabla() {
  const salida = psql(`select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users') or (n.nspname = 'storage' and c.relname = 'objects')) order by 1;`);
  return Object.fromEntries(salida.split("\n").filter(Boolean).map((l) => l.split("|")));
}

const temporales = () =>
  psql(`select id, email from auth.users where email like 'e2e.%@hogarian.test';`)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"))
    .filter(([, email]) => esTemporal(email));

async function crearCuentas() {
  const clave = crypto.randomBytes(18).toString("base64url").replace(/[-_]/g, "x") + "a1";
  for (const c of CUENTAS) {
    const { data, error } = await db.auth.admin.createUser({ email: c.email, email_confirm: true, app_metadata: { rol: c.rol, nombre: c.nombres } });
    if (error) throw new Error(`No pude crear ${c.email}: ${error.message}`);
    const { error: e2 } = await db.from("perfiles").insert({ user_id: data.user.id, nombre: c.nombres, nombres: c.nombres, rol: c.rol });
    if (e2) throw new Error(`Sin perfil ${c.email}: ${e2.message}`);
    const { error: e3 } = await db.rpc("fijar_contrasena", { p_user: data.user.id, p_clave: clave });
    if (e3) throw new Error(`Sin contraseña ${c.email}: ${e3.message}`);
  }
  return clave;
}

function playwright(clave, ...args) {
  const r = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...args], {
    stdio: "inherit",
    env: { ...process.env, ERP_PROD: CONEXION, PGPASSWORD: CLAVE_DB, ERP_PASS: clave, BASE, WORKERS: "2", REPORTE: "list", SALIDA: "prod" },
  });
  return r.status === 0;
}

/** Todo lo del recorrido: por nombre («E2E …»), por las cuentas temporales y desde `inicio`. */
async function limpiar(inicio) {
  const cuentas = temporales();
  const uids = cuentas.map(([id]) => id);
  const lista = (v) => v.map((x) => `'${x}'`).join(",") || "null";
  const desde = `'${inicio}'::timestamptz`;

  // Archivos: los subidos por las cuentas temporales y la firma de su gerente (la sube el servidor, sin dueño).
  const archivos = psql(`select bucket_id, name from storage.objects where created_at >= ${desde}
      and (owner_id in (${lista(uids)}) or ${uids.map((u) => `name like '%${u}%'`).join(" or ") || "false"});`)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
  for (const bucket of new Set(archivos.map(([b]) => b))) {
    const { error } = await db.storage.from(bucket).remove(archivos.filter(([b]) => b === bucket).map(([, n]) => n));
    if (error) console.error(`No pude borrar archivos de ${bucket}: ${error.message}`);
  }

  // Las obras del recorrido, también por la auditoría (la prueba ya pudo borrarlas por nombre).
  const obras = psql(`select distinct registro from audit_log where tabla = 'obras' and accion = 'INSERT' and created_at >= ${desde} and user_id in (${lista(uids)})
                      union select id::text from obras where nombre like 'E2E FLUJO %';`)
    .split("\n")
    .filter(Boolean);

  psql(`begin;
    set local session_replication_role = replica;
    create temp table _o on commit drop as select id from obras where nombre like 'E2E FLUJO %';
    create temp table _c on commit drop as select distinct comprobante_id id from oc_items where obra_id in (select id from _o) and comprobante_id is not null
      union select comprobante_id from pago_aplicaciones where obra_id in (select id from _o) and comprobante_id is not null;
    create temp table _p on commit drop as select distinct pago_id id from pago_aplicaciones where obra_id in (select id from _o) or comprobante_id in (select id from _c);
    delete from adjuntos where pago_id in (select id from _p);
    delete from pago_aplicaciones where pago_id in (select id from _p);
    delete from pagos where id in (select id from _p);
    update oc_items set comprobante_id = null where obra_id in (select id from _o);
    delete from comprobantes_historial where comprobante_id in (select id from _c);
    delete from comprobantes where id in (select id from _c);
    delete from entrega_fotos where entrega_id in (select id from entregas where obra_id in (select id from _o));
    do $$ declare t text; begin
      for t in select table_name from information_schema.columns c join pg_tables p on p.tablename = c.table_name and p.schemaname = 'public'
                where c.table_schema = 'public' and c.column_name = 'obra_id' loop
        execute format('delete from public.%I where obra_id in (select id from _o)', t);
      end loop;
    end $$;
    delete from obras where id in (select id from _o);
    create temp table _v on commit drop as select id from proveedores where razon_social like 'E2E PROVEEDOR FLUJO %';
    delete from proveedor_contactos where proveedor_id in (select id from _v);
    delete from proveedor_cuentas where proveedor_id in (select id from _v);
    delete from proveedor_tipos_material where proveedor_id in (select id from _v);
    delete from proveedores where id in (select id from _v);
    delete from items where descripcion like 'E2E CEMENTO FLUJO %' or descripcion like 'E2E PINTURA FLUJO %';
    delete from notificaciones where created_at >= ${desde}
      and (titulo like '%E2E%' or cuerpo like '%E2E%' or href ~ '(/|=)(${obras.join("|") || "0"})(/|$|&)');
    commit;`);

  for (const [id] of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.error(`No pude borrar la cuenta temporal: ${error.message}`);
  }

  // La auditoría del recorrido (al final: borrar las cuentas también deja registro).
  const filtroObras = obras.map((o) => `registro = '${o}' or registro like '${o}/%' or detalle->>'obra_id' = '${o}'`).join(" or ") || "false";
  const filtroCuentas = uids.map((u) => `registro like '%${u}%' or detalle::text like '%${u}%'`).join(" or ") || "false";
  psql(`begin;
    set local session_replication_role = replica;
    delete from audit_log where created_at >= ${desde} and (user_id in (${lista(uids)}) or detalle::text like '%E2E%' or detalle::text like '%e2e.%@hogarian.test%' or ${filtroObras} or ${filtroCuentas});
    -- Lo que hizo el proveedor desde su link queda como «Sistema»: los registros de lo que ya no existe.
    delete from audit_log a where a.created_at >= ${desde} and a.user_id is null and (
      (a.tabla = 'pagos' and not exists (select 1 from pagos p where p.id::text = a.registro))
      or (a.tabla = 'oc_items' and not exists (select 1 from oc_items l where l.id::text = a.registro)));
    -- Los accesos sin orden: la prueba entra con un token falso y con el link vencido.
    delete from cotizacion_accesos where created_at >= ${desde} and obra_id is null;
    commit;`);
  fs.rmSync(SESIONES, { recursive: true, force: true });
}

function diferencias(antes, despues) {
  return Object.keys({ ...antes, ...despues }).filter((t) => antes[t] !== despues[t]).map((t) => `${t}: ${antes[t]} → ${despues[t]}`);
}

if (process.argv.includes("--limpiar")) {
  const inicio = psql(`select coalesce(min(created_at), now() - interval '1 day') from auth.users where email like 'e2e.%@hogarian.test';`);
  await limpiar(inicio);
  console.log("Limpio.");
  process.exit(0);
}

if (temporales().length) {
  console.error("Hay cuentas temporales de una corrida anterior: npm run test:prod -- --limpiar");
  process.exit(2);
}

const antes = filasPorTabla();
const inicio = psql("select now();");
let ok = false;
try {
  const clave = await crearCuentas();
  fs.rmSync(SESIONES, { recursive: true, force: true });
  fs.mkdirSync(SESIONES, { recursive: true });
  ok = playwright(clave, "--project=sesiones") && playwright(clave, "tests/e2e/flujo.spec.ts", "--project=flujo", "--no-deps");
} finally {
  await limpiar(inicio);
}
const quedo = diferencias(antes, filasPorTabla());
console.log(ok ? "\nRecorrido: OK" : "\nRecorrido: FALLÓ");
console.log(quedo.length ? `Limpieza: cambiaron filas (revisar; puede ser actividad real)\n  ${quedo.join("\n  ")}` : "Limpieza: la base quedó con las mismas filas que antes");
process.exit(ok && !quedo.length ? 0 : 1);
