import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

export const ROLES = {
  logistica: "logistica@erp.local",
  contabilidad: "contabilidad@erp.local",
  tesoreria: "tesoreria@erp.local",
  residente: "residente@erp.local",
  gerencia: "gerencia@erp.local",
  operaciones: "operaciones@erp.local",
  jefe: "jefeoperaciones@erp.local",
  admin: "admin@erp.local",
  rrhh: "rrhh@erp.local",
} as const;
export type Rol = keyof typeof ROLES;

export const sesion = (rol: Rol) => path.resolve(`tests/e2e/.auth/${rol}.json`);

/** Consulta a la base local como postgres. Devuelve las filas como texto separado por «|». */
export function sql(consulta: string): string[][] {
  const out = execFileSync(
    "docker",
    ["exec", "-e", "PGCLIENTENCODING=UTF8", "supabase_db_erp-prod1", "psql", "-U", "postgres", "-At", "-F", "|", "-c", consulta],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}
/** Varias sentencias (p. ej. begin … rollback): devuelve las filas de todas, separadas por «|». */
export function sqlScript(script: string): string[][] {
  const out = execFileSync(
    "docker",
    ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "supabase_db_erp-prod1", "psql", "-U", "postgres", "-At", "-q", "-F", "|", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: script },
  );
  return out
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("|"));
}

/** Un solo valor. */
export const sql1 = (consulta: string) => sql(consulta)[0]?.[0] ?? "";

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
