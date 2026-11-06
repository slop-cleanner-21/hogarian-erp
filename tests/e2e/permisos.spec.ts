import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { test, expect } from "@playwright/test";
import { ROLES, sql, sql1, type Rol, sesionApi } from "./lib";

// Matriz de permisos por la API de Supabase, sin navegador: lectura por rol, escritura directa en tablas,
// funciones (RPC), archivos, registro cerrado, anon y un usuario sin perfil.
// Sin efectos: argumentos nulos, ids -1 y PATCH al mismo valor. Si una fila llegara a cambiar, la prueba la
// deja como estaba y falla.
// Según 20261031180000_permisos_por_rol, 20261102120000_lectura_por_rol,
// 20261102150000_sin_perfil_adjuntos_archivos, 20261102160000_registrar_pago_interno y
// 20261103120000_proveedor_cuentas, 20261104160000_prod1_consulta_orden y 20261104200000_prod1_items_gerencia.

const SB = "http://127.0.0.1:55321";
const CORTO = {
  LOG: "logistica",
  CON: "contabilidad",
  TES: "tesoreria",
  RES: "residente",
  GER: "gerencia",
  OPS: "operaciones",
  JEF: "jefe",
  RRHH: "rrhh",
} as const satisfies Record<string, Rol>;
type Corto = keyof typeof CORTO;
const CORTOS = Object.keys(CORTO) as Corto[];
const lista = (s: string) => CORTOS.filter((k) => s.split(/\s+/).includes(k));

// ---------------------------------------------------------------------------------------------------------
// Lectura: T = todas las filas · 0 = ninguna · P = parte (solo lo de sus obras) · M = las suyas (user_id) ·
// X = sin permiso sobre la tabla (solo el servidor la usa).
const LECTURA = tabla(`
  tabla                       LOG CON TES RES GER OPS JEF RRHH
  adelantos                    T   T   T   0   T   T   T   0
  adjuntos                     T   T   T   P   T   T   T   0
  asiento_lineas               0   T   0   0   0   0   0   0
  asientos                     T   T   T   0   0   0   0   0
  audit_log                    0   0   0   0   0   0   0   0
  avance_fotos                 T   T   T   P   T   T   T   0
  avances                      T   T   T   P   T   T   T   0
  comprobantes                 T   T   T   0   T   T   0   0
  comprobantes_historial       T   T   T   0   0   0   0   0
  cotizacion_accesos           T   0   0   0   0   0   0   0
  cuentas_contables            0   T   0   0   T   0   0   0
  datos_demo                   0   0   0   0   0   0   0   0
  empresas                     T   T   T   T   T   T   T   0
  entrega_fotos                T   T   T   P   T   T   T   0
  entregas                     T   T   T   P   T   T   T   0
  etapas                       T   T   T   T   T   T   T   0
  guias                        T   T   T   0   T   0   0   0
  items                        T   T   T   T   T   T   T   0
  notificaciones               M   M   M   M   M   M   M   M
  aviso_preferencias           M   M   M   M   M   M   M   M
  obra_etapas                  T   T   T   T   T   T   T   0
  obras                        T   T   T   P   T   T   T   0
  oc_items                     T   T   T   P   T   T   T   0
  ordenes_compra               T   T   T   P   T   T   T   0
  orden_borradores             M   0   0   0   0   0   0   0
  ordenes_pago                 T   T   T   0   0   0   0   0
  pago_aplicaciones            T   T   T   0   T   T   0   0
  pagos                        T   T   T   0   T   0   0   0
  partidas                     T   T   T   P   T   T   T   0
  perfil_obras                 T   T   T   P   T   T   T   0
  perfiles                     T   T   T   T   T   T   T   T
  perfil_privado               0   0   0   0   0   0   0   0
  perfil_roles                 M   M   M   M   M   M   M   M
  sugerencias                  X   X   X   X   X   X   X   X
  suspensiones_4ta             X   X   X   X   X   X   X   X
  huellas                      X   X   X   X   X   X   X   X
  huella_desafios              X   X   X   X   X   X   X   X
  credenciales                 X   X   X   X   X   X   X   X
  invitaciones                 X   X   X   X   X   X   X   X
  sesiones_bloqueo             X   X   X   X   X   X   X   X
  personas                     0   0   0   0   T   T   0   T
  proveedor_contactos          T   T   T   0   T   T   0   0
  proveedor_cuentas            T   T   T   0   T   0   0   0
  proveedor_tipos_material     T   T   T   0   T   T   0   0
  proveedores                  T   T   T   P   T   T   T   0
  push_suscripciones           M   M   M   M   M   M   M   M
  rechazos                     T   T   T   0   T   0   0   0
  requerimientos               T   T   T   T   T   T   T   0
  requerimientos_obra          T   T   T   0   T   T   T   0
  requerimientos_obra_items    T   T   T   0   T   T   T   0
  retenciones                  T   T   T   0   T   T   0   0
  detracciones                 T   T   T   0   T   T   0   0
  parametros                   T   T   T   T   T   T   T   T
  solicitud_adjuntos           0   0   0   0   T   T   0   0
  solicitudes                  0   0   0   0   T   T   0   T
  tipos_material               T   T   T   T   T   T   T   0
  transportistas               T   T   T   0   T   T   0   0
  valorizacion_partidas        T   T   T   T   T   T   T   0
  valorizaciones               T   T   T   P   T   T   T   0
`);

// Escritura directa (PATCH al mismo valor): quién afecta filas.
const ESCRITURA: [string, string][] = [
  ["items", "LOG"],
  ["proveedores", "LOG"],
  ["proveedor_cuentas", "LOG"],
  ["tipos_material", "LOG"],
  ["transportistas", "LOG"],
  ["cuentas_contables", "CON"],
  ["ordenes_pago", "CON"],
  ["ordenes_compra", ""],
  ["pagos", ""],
  ["adjuntos", ""],
  ["comprobantes", ""],
  ["asientos", ""],
  ["obras", ""],
  ["partidas", ""],
  ["personas", ""],
  ["solicitudes", ""],
];

// Funciones: quién pasa el control de rol (ADMIN siempre puede; anon, nadie).
const RPC: Record<string, string> = {
  actualizar_contacto_persona: "RRHH",
  actualizar_periodo_anotacion: "CON",
  adjuntar_solicitud: "OPS JEF",
  anular_orden: "LOG GER",
  anular_orden_pago: "CON",
  asignar_cuenta_item: "CON",
  asignar_cuenta_items: "CON",
  asignar_persona_obra: "GER JEF",
  cambiar_destino_igv: "CON",
  cerrar_entrega: "GER",
  cerrar_obra: "GER",
  confirmar_precios: "LOG",
  contabilizar_comprobante: "CON",
  contabilizar_pago: "CON",
  crear_orden: "LOG",
  crear_orden_pago: "CON",
  crear_orden_retencion: "LOG",
  crear_orden_valorizacion: "LOG",
  crear_requerimiento: "OPS JEF",
  editar_comprobante: "LOG",
  emitir_guia: "CON",
  enviar_a_tesoreria: "LOG",
  enviar_constancia: "LOG",
  enviar_contrato: "LOG",
  enviar_op_a_tesoreria: "CON",
  guardar_glosa_rhe: "LOG",
  guardar_obra: "GER",
  guardar_partidas: "GER",
  agregar_adicional: "GER",
  guardar_precios: "LOG",
  guardar_retenciones: "GER",
  guardar_detracciones: "GER",
  guardar_detraccion_minimo: "GER",
  marcar_cotizacion_enviada: "LOG",
  marcar_guia_anulada: "LOG",
  mo_partidas: "LOG CON TES RES GER OPS JEF",
  observar_avance: "OPS JEF",
  ordenar_etapas_obra: "JEF",
  pagar_documento: "TES",
  publicar_presupuesto: "GER",
  rechazar_documento: "TES",
  reemplazar_residente: "GER JEF",
  reenviar_cotizacion: "LOG",
  registrar_avance: "RES",
  registrar_comprobante: "LOG",
  registrar_entrega: "LOG RES",
  registrar_pago: "", // solo seeds y cargas (postgres / service_role)
  resolver_solicitud: "GER",
  revisar_solicitud: "JEF",
  set_requiere_guia: "LOG",
  set_datos_os: "LOG",
  reenviar_a_tesoreria: "LOG",
  enviar_si_lista: "LOG",
  solicitar_adicional: "OPS JEF",
  solicitar_baja_partida: "JEF",
  solicitar_guia: "LOG",
  registrar_guia: "LOG",
  solicitar_persona: "RRHH",
  valorizar: "OPS JEF",
};
// Funciones de lectura o internas que no necesitan fila en RPC; anular_requerimiento va aparte (mira el
// requerimiento antes que el rol, así que se prueba en SQL revertido).
const SIN_ROL = /^(fn_|rol_|mi_rol$|es_residente$|obras_residente$|orden_visible_residente$|ruta_obra_residente$|exigir_rol$|faltante$|glosa_rhe_defecto$|siguiente_numero_oc$|token_cotizacion_de$|rol_prod1$|get_cotizacion$|enviar_cotizacion$|anular_requerimiento$|sesion_bloqueada$|cambiar_rol$|enviar_sugerencia$|bloqueo_estado$|bloqueo_activar$)/;
const DENEGADO =
  /No tienes permiso|^Solo (Recursos Humanos|Operaciones|Gerencia|Logística|Contabilidad|Tesorería|el Jefe|los residentes|quien lo creó)|Inicia sesión|permission denied for function/i;

// Archivos: quién descarga y lista. Los objetos se eligen de la base; {res} = obras del residente.
const ARCHIVOS: [string, string, string, string][] = [
  ["vouchers pagos/", "documentos", "name like 'pagos/%'", "LOG CON TES GER"],
  ["vouchers demo/", "documentos", "name like 'demo/%'", "LOG CON TES GER"],
  ["bucket comprobantes", "comprobantes", "true", "LOG CON TES GER"],
  ["sustentos solicitudes/", "documentos", "name like 'solicitudes/%'", "GER OPS JEF"],
  ["guías", "documentos", "name like 'guias/%'", "LOG CON TES GER OPS JEF"],
  ["firmas de Gerencia", "documentos", "name like 'firmas/%'", ""],
  ["contrato de obra del residente", "documentos", "name like '%/CONTRATO/%' and split_part(name, '/', 1) in ({res})", "LOG CON TES GER OPS JEF"],
  ["contrato de otra obra", "documentos", "name like '%/CONTRATO/%' and split_part(name, '/', 1) not in ({res})", "LOG CON TES GER OPS JEF"],
  ["entregas de obras del residente", "documentos", "name like 'entregas/%' and split_part(name, '/', 2) in ({res})", "LOG CON TES RES GER OPS JEF"],
  ["avances de obras del residente", "documentos", "name like 'avances/%' and split_part(name, '/', 2) in ({res})", "LOG CON TES RES GER OPS JEF"],
];

// Prod 1 (20261105130000_prod1_seguridad), sobre la matriz del MVP: Contabilidad, Residente y RRHH no existen para
// la base (como sin perfil), y el Jefe de Operaciones no pasa ninguna función que escriba ni ve archivos salvo las
// fotos de las entregas. El Ingeniero de Operaciones (OPS) tiene exactamente lo mismo que el Jefe
// (20261106110000_prod1_ing_operaciones).
const FUERA = ["CON", "RES", "RRHH"];
const sin = (s: string, quitar: string[]) => s.split(/\s+/).filter((k) => k && !quitar.includes(k)).join(" ");
/** OPS pasa donde pasa el Jefe, y en nada más. */
const comoJefe = (s: string) => {
  const r = sin(s, ["OPS"]);
  return r.split(" ").includes("JEF") ? `${r} OPS`.trim() : r;
};
for (const fila of Object.values(LECTURA)) {
  for (const k of FUERA) if (fila[k as Corto] !== "X") fila[k as Corto] = "0";
  fila.OPS = fila.JEF;
}
for (const e of ESCRITURA) e[1] = comoJefe(sin(e[1], FUERA));
// Ítems: Logística solo cambia tipo_material (el PATCH de la prueba va sobre la clave); lo prueba seguridad.spec.
ESCRITURA.find(([t]) => t === "items")![1] = "";
const RPC_MVP = { ...RPC };
// mo_partidas solo lee: el Jefe la sigue usando.
for (const fn of Object.keys(RPC)) RPC[fn] = comoJefe(sin(RPC[fn], fn === "mo_partidas" ? FUERA : [...FUERA, "JEF"]));
for (const a of ARCHIVOS) a[3] = comoJefe(sin(a[3], a[0].startsWith("entregas") ? FUERA : [...FUERA, "JEF"]));

// ---------------------------------------------------------------------------------------------------------
type Sesion = { token: string; uid: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON tal como lo devuelve la API
type Json = any;
type Respuesta = { status: number; datos: Json; msg: string; headers: Headers };
type Fila = Record<string, unknown>;
/** Lo que las pruebas necesitan de la base, leído de una vez por worker. */
type Base = {
  tablas: Record<string, { n: number; pk: string[] }>;
  vistas: string[];
  suyas: Record<string, Record<string, number> | null>;
  muestras: Record<string, Fila | null>;
  perfiles: Fila[];
  archivos: Record<string, string | null>;
  firmas: Record<string, string>;
  fnsAuth: string[];
  fnsAnon: string[];
  req: { id: number; creador: string } | null;
  obra: number;
  partida: number;
};
let ANON = "";
let SECRETA = "";
let B: Base;
const S = {} as Record<Corto, Sesion>;
const SUJETOS = [...CORTOS, "anon"] as const;
const tok = (k: Corto | "anon") => (k === "anon" ? null : S[k].token);

function tabla(texto: string) {
  const [cab, ...filas] = texto.trim().split("\n").map((l) => l.trim().split(/\s+/));
  const cols = cab.slice(1) as Corto[];
  return Object.fromEntries(filas.map(([t, ...v]) => [t, Object.fromEntries(cols.map((k, i) => [k, v[i]])) as Record<Corto, string>]));
}

const json = (q: string) => JSON.parse(sql(q).map((r) => r.join("|")).join("\n") || "null");
const lit = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

function cargarBase(): Base {
  const res = `(select po.obra_id::text from perfil_obras po join auth.users u on u.id = po.user_id where u.email = '${ROLES.residente}')`;
  const propias = Object.keys(LECTURA).filter((t) => LECTURA[t].LOG === "M");
  const publicas = (relkind: string) => `pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = '${relkind}'`;
  const fns = `pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`;
  return json(`select json_build_object(
    'tablas', (select json_object_agg(c.relname, json_build_object(
      'n', (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint,
      'pk', (select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) from pg_index i
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey) where i.indrelid = c.oid and i.indisprimary)))
      from ${publicas("r")}),
    'vistas', (select json_agg(c.relname) from ${publicas("v")}),
    'suyas', json_build_object(${propias.map((t) => `'${t}', (select json_object_agg(u.email, x.n) from (select user_id, count(*) n from public.${t} group by 1) x join auth.users u on u.id = x.user_id)`).join(", ")}),
    'muestras', json_build_object(${ESCRITURA.map(([t]) => `'${t}', (select row_to_json(x) from (select * from public.${t} order by 1 limit 1) x)`).join(", ")}),
    'perfiles', (select json_agg(row_to_json(p)) from public.perfiles p),
    'archivos', json_build_object(${ARCHIVOS.map(([n, b, donde]) => `'${n}', (select name from storage.objects where bucket_id = '${b}' and ${donde.replaceAll("{res}", res)} order by name limit 1)`).join(", ")}),
    'firmas', (select json_object_agg(p.proname, pg_get_function_identity_arguments(p.oid)) from ${fns}),
    'fnsAuth', (select json_agg(p.proname order by p.proname) from ${fns} and p.prorettype <> 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')),
    'fnsAnon', (select json_agg(p.proname order by p.proname) from ${fns} and has_function_privilege('anon', p.oid, 'execute')),
    'req', (select json_build_object('id', id, 'creador', created_by) from requerimientos_obra where estado = 'VIGENTE' order by id limit 1),
    'obra', (select min(id) from obras),
    'partida', (select min(id) from partidas))`);
}

async function api(token: string | null, metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}): Promise<Respuesta> {
  const r = await fetch(SB + ruta, {
    method: metodo,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, "Content-Type": "application/json", ...extra },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos: Json = texto;
  try {
    datos = JSON.parse(texto);
  } catch {}
  return { status: r.status, datos, msg: String(datos?.message ?? datos?.msg ?? datos?.error ?? texto), headers: r.headers };
}

async function entrar(email: string): Promise<Sesion> {
  const s = await sesionApi(SB, ANON, SECRETA, email);
  return { token: s.access_token, uid: s.user.id };
}
const salir = (token: string) => api(token, "POST", "/auth/v1/logout?scope=local").catch(() => {});

/** Filas visibles por la API (Content-Range), o el código de error. */
async function contar(token: string | null, rel: string): Promise<number | string> {
  // Una columna de la clave (ordenes_compra se lee por columnas: token_cotizacion no).
  const r = await api(token, "GET", `/rest/v1/${rel}?select=${B.tablas[rel]?.pk?.[0] ?? "*"}`, undefined, { Prefer: "count=exact", Range: "0-0" });
  return r.status >= 400 ? `error ${r.status}` : Number(r.headers.get("content-range")?.split("/")[1]);
}

/** Descarga el objeto y lista su carpeta: [código de la descarga, entradas listadas]. */
async function verArchivo(token: string | null, bucket: string, obj: string): Promise<[number, number]> {
  const d = await fetch(`${SB}/storage/v1/object/authenticated/${bucket}/${obj}`, { headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}` } });
  await d.arrayBuffer();
  const l = await api(token, "POST", `/storage/v1/object/list/${bucket}`, { prefix: obj.slice(0, obj.lastIndexOf("/")), limit: 100 });
  return [d.status, Array.isArray(l.datos) ? l.datos.length : 0];
}

/** Compara las filas con cómo están ahora; las que cambiaron vuelven a su valor sin disparar triggers. */
function revertir(rel: string, antes: Fila[]): string[] {
  const pk = B.tablas[rel].pk;
  const donde = (f: Fila) => pk.map((c) => `x.${c} = ${lit(f[c])}`).join(" and ");
  const ahora: Fila[] = json(`select json_agg(row_to_json(x)) from public.${rel} x where ${antes.map((f) => `(${donde(f)})`).join(" or ")}`) ?? [];
  const cambios: string[] = [];
  for (const f of antes) {
    const a = ahora.find((r) => pk.every((c) => r[c] === f[c])) ?? {};
    const cols = Object.keys(f).filter((c) => JSON.stringify(f[c]) !== JSON.stringify(a[c]));
    if (!cols.length) continue;
    cambios.push(`${pk.map((c) => f[c]).join("/")}: ${cols.join(", ")}`);
    sql(
      `set session_replication_role = replica; update public.${rel} x set ${cols.map((c) => `${c} = r.${c}`).join(", ")} ` +
        `from json_populate_record(null::public.${rel}, $j$${JSON.stringify(f)}$j$) r where ${donde(f)}`,
    );
  }
  return cambios;
}

/** PATCH al mismo valor: true si la API devolvió filas actualizadas. */
const escribio = (r: Respuesta) => r.status < 300 && Array.isArray(r.datos) && r.datos.length > 0;

/** Ejecuta `llamada` en SQL como cada usuario, en bloques que siempre se revierten. Devuelve el error de cada uno
 *  (o EJECUTA si no hubo error). */
function comoUsuarios(uids: string[], llamada: string): string[] {
  const bloque = (uid: string, i: number) =>
    `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: "authenticated" }))}, true) is null; set local role authenticated; ` +
    `do $b$ begin perform ${llamada}; raise exception 'EJECUTA'; ` +
    `exception when others then perform set_config('permisos.r', sqlerrm, true); end $b$; ` +
    `reset role; select 'R', ${i}, current_setting('permisos.r');`;
  const out = sql(`begin; ${uids.map(bloque).join(" ")} rollback;`).filter((r) => r[0] === "R");
  return uids.map((_, i) => out.find((r) => r[1] === String(i))?.slice(2).join("|") ?? "sin respuesta");
}

/** Argumentos sin efecto: ids -1, uuid en ceros y lo demás nulo. guardar_partidas y solicitar_baja_partida miran
 *  la fila antes que el rol: van con una que existe y un dato que las hace fallar después del control. */
function argumentos(fn: string): Fila {
  const firma = B.firmas[fn];
  if (firma === undefined) throw new Error(`No existe la función ${fn}`);
  const cuerpo: Fila = Object.fromEntries(
    firma
      .split(", ")
      .filter(Boolean)
      .map((a) => {
        const [n, ...t] = a.replace(/^VARIADIC /, "").split(" ");
        const tipo = t.join(" ");
        const id = tipo === "bigint" && /(^p_id$|_id$|^p_sale$|^p_entra$)/.test(n);
        return [n, id ? -1 : tipo === "uuid" ? "00000000-0000-0000-0000-000000000000" : null];
      }),
  );
  if (fn === "guardar_partidas") cuerpo.p_obra_id = B.obra;
  if (fn === "solicitar_baja_partida") Object.assign(cuerpo, { p_partida_id: B.partida, p_cantidad: 0 });
  return cuerpo;
}

// ---------------------------------------------------------------------------------------------------------
test.beforeAll(async ({}, info) => {
  test.skip(info.project.name === "m360", "Pruebas de API: basta con un proyecto");
  expect(process.env.ERP_PASS, "Define ERP_PASS").toBeTruthy();
  const env = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  ANON = /^ANON_KEY="?([^"\r\n]+)"?/m.exec(env)?.[1] ?? "";
  SECRETA = /^SERVICE_ROLE_KEY="?([^"\r\n]+)"?/m.exec(env)?.[1] ?? "";
  expect(ANON, "ANON_KEY de `supabase status`").not.toBe("");
  B = cargarBase();
  const sesiones = await Promise.all(CORTOS.map((k) => entrar(ROLES[CORTO[k]])));
  CORTOS.forEach((k, i) => (S[k] = sesiones[i]));
});
test.afterAll(async () => {
  await Promise.all(Object.values(S).map((s) => salir(s.token)));
});

test.describe("@permisos lectura por rol", () => {
  test("la matriz cubre todas las tablas", () => {
    expect(Object.keys(B.tablas).filter((t) => !(t in LECTURA)), "tablas sin fila en LECTURA").toEqual([]);
  });

  for (const k of CORTOS) {
    test(`${k} lee lo que le toca`, async () => {
      const fallas = await Promise.all(
        Object.entries(LECTURA).map(async ([t, fila]) => {
          const e = fila[k];
          const total = B.tablas[t]?.n;
          const n = await contar(S[k].token, t);
          if (e === "P") return typeof n === "number" && n <= total ? null : `${t}: ${n} (esperado ≤ ${total})`;
          if (e === "X") return typeof n === "string" && /error 40[13]/.test(n) ? null : `${t}: ${n} (esperado sin permiso)`;
          const esperado = e === "T" ? total : e === "M" ? (B.suyas[t]?.[ROLES[CORTO[k]]] ?? 0) : 0;
          if (n === esperado) return null;
          // Otras specs escriben y revierten en paralelo (p. ej. un asiento): con «todas», se vuelve a
          // comparar contra el conteo de este momento en vez de la foto del inicio.
          if (e === "T") {
            const ahora = Number(sql1(`select count(*) from public.${t}`));
            const otra = await contar(S[k].token, t);
            if (otra === ahora) return null;
          }
          return `${t}: ${n} (esperado ${esperado}${e === "T" ? ", todas" : ""})`;
        }),
      );
      expect(fallas.filter(Boolean), `${k}: filas por la API distintas de lo esperado`).toEqual([]);
    });
  }

  test("anon no lee ninguna tabla ni vista", async () => {
    const rels = [...Object.keys(B.tablas), ...B.vistas];
    const n = await Promise.all(rels.map((t) => contar(null, t)));
    expect(rels.map((t, i) => `${t}: ${n[i]}`).filter((_, i) => typeof n[i] === "number" && n[i] !== 0)).toEqual([]);
  });
});

test.describe("@permisos escritura en tablas", () => {
  for (const [rel, quienes] of ESCRITURA) {
    test(`${rel}: escribe ${quienes || "nadie"}`, async () => {
      const antes = B.muestras[rel];
      test.skip(!antes, `${rel} está vacía`);
      const pk = B.tablas[rel].pk;
      const filtro = pk.map((c) => `${c}=eq.${encodeURIComponent(String(antes![c]))}`).join("&");
      const r = await Promise.all(
        SUJETOS.map((k) => api(tok(k), "PATCH", `/rest/v1/${rel}?${filtro}`, { [pk[0]]: antes![pk[0]] }, { Prefer: "return=representation" })),
      );
      expect(revertir(rel, [antes!]), `${rel}: la fila cambió (ya revertida)`).toEqual([]);
      expect(SUJETOS.filter((_, i) => escribio(r[i])), `${rel}: roles que actualizaron la fila`).toEqual(lista(quienes));
    });
  }

  test("perfiles: nadie cambia su rol", async () => {
    const antes = CORTOS.map((k) => B.perfiles.find((p) => p.user_id === S[k].uid)!);
    const r = await Promise.all(
      CORTOS.map((k, i) => api(S[k].token, "PATCH", `/rest/v1/perfiles?user_id=eq.${S[k].uid}`, { rol: antes[i].rol }, { Prefer: "return=representation" })),
    );
    expect(revertir("perfiles", antes), "perfiles cambiados (ya revertidos)").toEqual([]);
    expect(CORTOS.filter((_, i) => escribio(r[i])), "roles que actualizaron su perfil").toEqual([]);
  });
});

test.describe("@permisos funciones (RPC)", () => {
  test("toda función que escribe tiene su fila en RPC", () => {
    expect(B.fnsAuth.filter((n) => !(n in RPC) && !SIN_ROL.test(n)), "funciones sin rol esperado en la spec").toEqual([]);
  });

  for (const [fn, quienes] of Object.entries(RPC)) {
    test(`${fn}: pasa ${quienes || "nadie"}`, async () => {
      const cuerpo = argumentos(fn);
      const r = await Promise.all(SUJETOS.map((k) => api(tok(k), "POST", `/rest/v1/rpc/${fn}`, cuerpo)));
      const pasan = SUJETOS.filter((_, i) => !(r[i].status >= 400 && DENEGADO.test(r[i].msg)));
      const ejecutaron = SUJETOS.filter((k, i) => r[i].status < 300 && !lista(quienes).includes(k as Corto));
      const detalle = SUJETOS.map((k, i) => `${k} ${r[i].status} ${r[i].msg.slice(0, 60)}`).join("\n");
      expect(ejecutaron, `${fn} se ejecutó sin el rol:\n${detalle}`).toEqual([]);
      expect(pasan, `${fn}: roles que pasan el control de rol\n${detalle}`).toEqual(lista(quienes));
      if (!RPC_MVP[fn]) expect(r.every((x) => /permission denied for function/i.test(x.msg)), `${fn}: sin EXECUTE para nadie\n${detalle}`).toBe(true);
    });
  }

  test("anular_requerimiento: solo JEF y quien lo creó (SQL revertido)", () => {
    test.skip(!B.req, "sin requerimientos vigentes");
    const { id, creador } = B.req!;
    const r = comoUsuarios(
      CORTOS.map((k) => S[k].uid),
      `public.anular_requerimiento(${id}, null)`,
    );
    const pasan = CORTOS.filter((_, i) => !DENEGADO.test(r[i]));
    // Prod 1: ni el Jefe (ni el Ingeniero de Operaciones, que es como él) ni un creador fuera de prod 1.
    expect(pasan, CORTOS.map((k, i) => `${k} ${r[i]}`).join("\n")).toEqual(
      CORTOS.filter((k) => S[k].uid === creador && k !== "JEF" && k !== "OPS" && !FUERA.includes(k)),
    );
  });

  test("anon solo ejecuta get_cotizacion y enviar_cotizacion", async () => {
    expect(B.fnsAnon).toEqual(["enviar_cotizacion", "get_cotizacion"]);
    // Token inexistente: falla dentro de la función (no por permisos) y no escribe nada.
    const r = await api(null, "POST", "/rest/v1/rpc/enviar_cotizacion", { p_token: crypto.randomUUID(), p_precios: null });
    expect(r.msg).toMatch(/link ya no está disponible/);
  });
});

test.describe("@permisos archivos", () => {
  for (const [nombre, bucket, , quienes] of ARCHIVOS) {
    test(`${nombre}: ${quienes}`, async () => {
      const obj = B.archivos[nombre];
      test.skip(!obj, `sin archivos de ${nombre}`);
      const r = await Promise.all(SUJETOS.map((k) => verArchivo(tok(k), bucket, obj!)));
      const fallas = SUJETOS.map((k, i) => {
        const [descarga, listados] = r[i];
        const debe = lista(quienes).includes(k as Corto);
        return (descarga === 200) === debe && listados > 0 === debe ? null : `${k}: descarga ${descarga}, lista ${listados} (debería ${debe ? "ver" : "no ver"})`;
      });
      expect(fallas.filter(Boolean), `${bucket}/${obj}`).toEqual([]);
    });
  }
});

test.describe("@permisos registro", () => {
  test("signup apagado: no crea usuarios", async () => {
    const email = `permisos-signup-${crypto.randomUUID()}@example.com`;
    const r = await api(null, "POST", "/auth/v1/signup", { email, password: crypto.randomBytes(18).toString("base64url") });
    const creados = Number(sql1(`select count(*) from auth.users where email = '${email}'`));
    if (creados) sql(`delete from auth.users where email = '${email}'`);
    expect(creados, "usuarios creados por signup (borrados)").toBe(0);
    expect(r.datos?.access_token, "signup devolvió sesión").toBeUndefined();
    expect(r.status, r.msg).toBeGreaterThanOrEqual(400);
  });
});

test.describe("@permisos usuario sin perfil", () => {
  // Un solo usuario por corrida: estas pruebas van en el mismo worker.
  test.describe.configure({ mode: "default" });
  const id = crypto.randomUUID();
  const email = `permisos-sinperfil-${id}@example.com`;
  const clave = crypto.randomBytes(18).toString("base64url");
  let sp: Sesion | undefined;

  test.beforeAll(async () => {
    sql(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, ` +
        `created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current) ` +
        `values ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}', ` +
        `extensions.crypt('${clave}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', ''); ` +
        `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) ` +
        `values (gen_random_uuid(), '${id}', '${id}', jsonb_build_object('sub', '${id}', 'email', '${email}', 'email_verified', true), 'email', now(), now(), now());`,
    );
    sp = await entrar(email);
  });
  test.afterAll(async () => {
    if (sp) await salir(sp.token);
    sql(`delete from auth.identities where user_id = '${id}'; delete from auth.users where id = '${id}';`);
  });

  test("no tiene perfil y no lee ninguna tabla ni vista", async () => {
    expect(B.perfiles.some((p) => p.user_id === id)).toBe(false);
    const rels = [...Object.keys(B.tablas), ...B.vistas];
    const n = await Promise.all(rels.map((t) => contar(sp!.token, t)));
    expect(rels.map((t, i) => `${t}: ${n[i]}`).filter((_, i) => typeof n[i] === "number" && n[i] !== 0)).toEqual([]);
  });

  test("todas las funciones dan el error de rol", async () => {
    const fns = Object.keys(RPC);
    const r = await Promise.all(fns.map((fn) => api(sp!.token, "POST", `/rest/v1/rpc/${fn}`, argumentos(fn))));
    const pasan = fns.map((fn, i) => (r[i].status >= 400 && DENEGADO.test(r[i].msg) ? null : `${fn}: ${r[i].status} ${r[i].msg.slice(0, 60)}`));
    if (B.req) {
      const [msg] = comoUsuarios([id], `public.anular_requerimiento(${B.req.id}, null)`);
      pasan.push(DENEGADO.test(msg) ? null : `anular_requerimiento: ${msg}`);
    }
    expect(pasan.filter(Boolean)).toEqual([]);
  });

  test("no ve archivos", async () => {
    const r = await Promise.all(
      ARCHIVOS.filter(([n]) => B.archivos[n]).map(async ([n, bucket]) => {
        const [descarga, listados] = await verArchivo(sp!.token, bucket, B.archivos[n]!);
        return descarga === 200 || listados > 0 ? `${n}: descarga ${descarga}, lista ${listados}` : null;
      }),
    );
    expect(r.filter(Boolean)).toEqual([]);
  });
});
