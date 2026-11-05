import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

// Con ERP_PROD (lo pone scripts/recorrido-prod.mjs) las pruebas corren contra producción: cuentas temporales e2e.*,
// sesiones en otra carpeta y la base de la nube. Sin ella, todo como siempre (local).
export const EN_PROD = !!process.env.ERP_PROD;
const correo = (local: string, rol: string) => (EN_PROD ? `e2e.${rol}@hogarian.test` : `${local}@erp.local`);

export const ROLES = {
  logistica: correo("logistica", "logistica"),
  contabilidad: correo("contabilidad", "contabilidad"),
  tesoreria: correo("tesoreria", "tesoreria"),
  residente: correo("residente", "residente"),
  gerencia: correo("gerencia", "gerencia"),
  operaciones: correo("operaciones", "operaciones"),
  jefe: correo("jefeoperaciones", "jefe"),
  admin: correo("admin", "admin"),
  rrhh: correo("rrhh", "rrhh"),
} as const;
export type Rol = keyof typeof ROLES;

export const sesion = (rol: Rol) => path.resolve(`tests/e2e/.auth/${EN_PROD ? "prod/" : ""}${rol}.json`);

/** psql en el contenedor local: contra esa base o, en producción, contra la de la nube (la clave va por el entorno). */
const psql = (...args: string[]) => [
  "exec",
  ...(args.includes("-c") ? [] : ["-i"]),
  "-e",
  "PGCLIENTENCODING=UTF8",
  ...(EN_PROD ? ["-e", "PGPASSWORD"] : []),
  "supabase_db_erp-prod1",
  "psql",
  ...(EN_PROD ? [process.env.ERP_PROD!] : ["-U", "postgres"]),
  ...args,
];

/** Consulta a la base local como postgres. Devuelve las filas como texto separado por «|». */
export function sql(consulta: string): string[][] {
  const out = execFileSync("docker", psql("-At", "-F", "|", "-c", consulta), { encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}
/** Varias sentencias (p. ej. begin … rollback): devuelve las filas de todas, separadas por «|». */
export function sqlScript(script: string): string[][] {
  const out = execFileSync("docker", psql("-At", "-q", "-F", "|", "-v", "ON_ERROR_STOP=1"), { encoding: "utf8", input: script });
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}

/**
 * Una sesión por la API (sin la app): las contraseñas no están en Supabase Auth (credenciales), así que se abre como
 * lo hace el servidor, con un enlace mágico de un solo uso (necesita la clave secreta).
 */
export async function sesionApi(sb: string, anon: string, secreta: string, email: string, intento = 0): Promise<{ access_token: string; user: { id: string } }> {
  const l = await fetch(`${sb}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: secreta, Authorization: `Bearer ${secreta}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link = (await l.json()) as { hashed_token?: string; properties?: { hashed_token?: string }; msg?: string };
  const hash = link.hashed_token ?? link.properties?.hashed_token;
  if (!hash) throw new Error(`Sin enlace para ${email}: ${l.status} ${link.msg ?? ""}`);
  const v = await fetch(`${sb}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hash }),
  });
  const s = await v.json();
  // Un solo enlace por usuario: si otro worker abrió la misma cuenta a la vez, este quedó reemplazado. Otra vez.
  if (!s.access_token && s.error_code === "otp_expired" && intento < 6) {
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 400));
    return sesionApi(sb, anon, secreta, email, intento + 1);
  }
  if (!s.access_token) throw new Error(`No pude abrir la sesión de ${email}: ${v.status} ${s.msg ?? ""}`);
  return s;
}

/** Un solo valor. */
export const sql1 = (consulta: string) => sql(consulta)[0]?.[0] ?? "";

// El usuario de prueba de cada rol de la base (por su correo). «El primero con ese rol» no sirve: otras pruebas (o
// una auditoría) crean usuarios con el mismo rol, a veces desactivados, mientras la suite corre en paralelo.
const ROL_DB: Record<string, Rol> = {
  LOGISTICA: "logistica",
  CONTABILIDAD: "contabilidad",
  TESORERIA: "tesoreria",
  RESIDENTE: "residente",
  GERENCIA: "gerencia",
  OPERACIONES: "operaciones",
  JEFE_OPERACIONES: "jefe",
  ADMIN: "admin",
  RRHH: "rrhh",
};
/** SQL: el id del usuario de prueba del rol (LOGISTICA, TESORERIA…). */
export const uidSql = (rolDb: string) => `(select id from auth.users where email = '${ROLES[ROL_DB[rolDb]]}')`;
/** El id del usuario de prueba del rol. */
export const uidDe = (rolDb: string) => sql1(`select ${uidSql(rolDb)}`);

/** Textos que nunca deben verse. */
export const ERRORES = /No tienes permiso|permission denied|row-level security|Algo salió mal|Application error|Unhandled Runtime Error/i;

export type Revision = {
  desborde: number;
  selectsNativos: number;
  chicos: string[];
  textoChico: string[];
  error: string | null;
};

/** Revisión estándar de móvil de lo que está en pantalla. */
export async function revisar(page: Page): Promise<Revision> {
  const datos = await page.evaluate(() => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const interactivos = [
      ...document.querySelectorAll('a[href], button, [role=button], input:not([type=hidden]), textarea, [role=option], [role=tab]'),
    ].filter(visible);
    const chicos = interactivos
      .map((e) => {
        const r = e.getBoundingClientRect();
        let w = r.width;
        let h = r.height;
        const lab = e.closest("label");
        if (lab && e.tagName === "INPUT") {
          const lr = lab.getBoundingClientRect();
          w = Math.max(w, lr.width);
          h = Math.max(h, lr.height);
        }
        const nombre = (e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
        return { nombre, w: Math.round(w), h: Math.round(h) };
      })
      .filter((x) => x.w < 44 || x.h < 44)
      .map((x) => `${x.nombre} ${x.w}×${x.h}`);
    const textos = new Set<string>();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const t = tw.currentNode.textContent?.trim();
      const el = tw.currentNode.parentElement;
      if (!t || !el || !visible(el) || el.closest(".sr-only")) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 13) textos.add(`${fs}px «${t.slice(0, 30)}»`);
    }
    return {
      desborde: document.documentElement.scrollWidth - window.innerWidth,
      selectsNativos: [...document.querySelectorAll("select")].filter(visible).length,
      chicos: [...new Set(chicos)].slice(0, 15),
      textoChico: [...textos].slice(0, 15),
      texto: document.body.innerText,
    };
  });
  const m = datos.texto.match(ERRORES);
  return { desborde: datos.desborde, selectsNativos: datos.selectsNativos, chicos: datos.chicos, textoChico: datos.textoChico, error: m?.[0] ?? null };
}

/** Espera a que la pantalla termine de cargar (sin colgarse con la carga infinita). */
export async function listo(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}
