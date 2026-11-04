import { test as base, expect, type Page } from "@playwright/test";
import { listo, revisar, sesion, type Rol } from "./lib";

type Fallas = { consola: string[]; http: string[] };

/**
 * `abrir(rol, ruta)`: página con la sesión del rol, ya cargada. Junta errores de consola y respuestas
 * 4xx/5xx; al terminar cada prueba falla si hubo alguno. `revisarPantalla(page)` aplica la revisión de
 * móvil: sin desborde, sin <select> nativo, sin textos de error; los toques chicos y el texto de menos
 * de 13 px quedan como avisos en el reporte (no fallan).
 */
export const test = base.extend<{
  abrir: (rol: Rol, ruta: string) => Promise<Page>;
  revisarPantalla: (page: Page) => Promise<void>;
}>({
  abrir: async ({ browser }, usar, info) => {
    const fallas: Fallas = { consola: [], http: [] };
    const contextos: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await usar(async (rol, ruta) => {
      const ctx = await browser.newContext({ ...info.project.use, storageState: sesion(rol) });
      contextos.push(ctx);
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.type() === "error") fallas.consola.push(`${rol} ${m.text().slice(0, 200)}`);
      });
      page.on("pageerror", (e) => fallas.consola.push(`${rol} pageerror ${e.message.slice(0, 200)}`));
      page.on("response", (r) => {
        const u = r.url();
        if (r.status() >= 400 && !/favicon/.test(u)) fallas.http.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 120)}`);
      });
      await page.goto(ruta);
      await listo(page);
      expect(page.url(), `${rol} fue redirigido al abrir ${ruta}`).not.toMatch(/\/(login|acceso)(\?|$)/);
      return page;
    });
    // Bajo carga, cerrar con la traza abierta a veces da ENOENT en sus archivos temporales: no es una falla de la app.
    for (const c of contextos) await c.close().catch(() => {});
    expect(fallas.consola, "errores de consola").toEqual([]);
    expect(fallas.http, "respuestas 4xx/5xx").toEqual([]);
  },
  revisarPantalla: async ({}, usar, info) => {
    await usar(async (page) => {
      const r = await revisar(page);
      if (r.chicos.length) info.annotations.push({ type: "aviso: toques < 44 px", description: r.chicos.join("; ") });
      if (r.textoChico.length) info.annotations.push({ type: "aviso: texto < 13 px", description: r.textoChico.join("; ") });
      expect(r.error, "texto de error en pantalla").toBeNull();
      expect(r.desborde, "scroll horizontal (px)").toBeLessThanOrEqual(1);
      expect(r.selectsNativos, "<select> nativo").toBe(0);
    });
  },
});

export { expect };
