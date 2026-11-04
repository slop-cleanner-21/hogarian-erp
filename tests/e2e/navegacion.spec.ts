import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, type Rol } from "./lib";

// Al volver a una lista (botón «Volver» de la app, atrás del navegador o la barra inferior), los
// filtros deben estar desde el primer pintado: sin pasar por la lista sin filtrar ni saltos de URL.

type Caso = {
  rol: Rol;
  lista: string;
  filtrada: string;
  /** Clic que abre un detalle desde la lista. */
  abrir: (p: Page) => Promise<void>;
  /** Nombre del enlace de la barra inferior que lleva a la lista, y otra pantalla del módulo que la tiene. */
  nav: string;
  otra: string;
};

const [empresaTes] = sql("select empresa_id from v_por_pagar where estado = 'PENDIENTE' group by 1 order by count(*) desc limit 1")[0];
const [obraTes] = sql(`select obra_id from v_por_pagar where estado = 'PENDIENTE' and empresa_id = ${empresaTes} group by 1 order by count(*) desc limit 1`)[0];
const [obraLog] = sql("select obra_id from ordenes_compra where tipo = 'OC' group by 1 order by count(*) desc limit 1")[0];

const CASOS: Caso[] = [
  {
    rol: "tesoreria",
    lista: "/tesoreria",
    filtrada: `/tesoreria?empresa=${empresaTes}&area=log&obra=${obraTes}`,
    abrir: (p) => p.locator("main a[href^='/tesoreria/pago/']").first().click(),
    nav: "Pagos",
    otra: "/tesoreria/consultas",
  },
  {
    rol: "logistica",
    lista: "/logistica?tipo=OC",
    // «Todas»: la pestaña de entrada (Cotizando) puede no tener órdenes de esa obra.
    filtrada: `/logistica?tipo=OC&tab=todas&obra=${obraLog}`,
    abrir: (p) => p.locator("main a[href^='/logistica/ordenes/']").first().click(),
    nav: "OC",
    otra: "/logistica/proveedores",
  },
  {
    rol: "gerencia",
    lista: "/gerencia/ordenes",
    filtrada: `/gerencia/ordenes?obra=${obraLog}`,
    abrir: (p) => p.locator("main a[href^='/consulta/orden/']").first().click(),
    nav: "Órdenes",
    otra: "/gerencia/obras",
  },
];

/** El filtro que distingue la vista filtrada (el último parámetro de `filtrada`). */
const filtroDe = (c: Caso) => new URL(c.filtrada, "http://x").search.split("&").pop()!.replace(/^\?/, "");
/** Ninguna URL de la lista sin el filtro (Next puede repetir la misma URL al guardar su estado: no cuenta). */
function sinPasarPorLaListaPelada(c: Caso, urls: string[]) {
  const lista = new URL(c.lista, "http://x").pathname;
  const peladas = urls.filter((u) => u.split("?")[0] === lista && !u.includes(filtroDe(c)));
  expect(peladas, `pasó por la lista sin filtro: ${urls.join(" → ")}`).toEqual([]);
}

/** Espera a que la lista guarde su vista (lo hace al terminar de cargar en el navegador). */
async function vistaGuardada(page: Page, c: Caso) {
  const path = new URL(c.lista, "http://x").pathname;
  await expect
    .poll(() => page.evaluate(([p, f]) => decodeURIComponent(document.cookie).includes(`"${p}"`) && decodeURIComponent(document.cookie).includes(f), [path, filtroDe(c)]))
    .toBe(true);
}

/** Espera a que la lista quede en la URL final (con o sin redirección). */
const enLista = (page: Page, c: Caso) => page.waitForURL((u) => u.pathname === new URL(c.lista, "http://x").pathname && u.search.includes(filtroDe(c)));

/** Registra cada URL por la que pasa la pestaña desde ahora. */
function seguirUrls(page: Page) {
  const urls: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) urls.push(new URL(f.url()).pathname + new URL(f.url()).search);
  });
  return urls;
}

for (const c of CASOS) {
  test.describe(`@navegacion @${c.rol}`, () => {
    test(`${c.rol}: al volver con «Volver» la lista conserva el filtro sin parpadeo`, async ({ abrir }) => {
      const page = await abrir(c.rol, c.filtrada);
      await vistaGuardada(page, c);
      await c.abrir(page);
      await page.waitForURL((u) => u.pathname !== new URL(c.filtrada, "http://x").pathname || u.search !== new URL(c.filtrada, "http://x").search);
      const urls = seguirUrls(page);
      await page.getByRole("button", { name: "Volver" }).click();
      await enLista(page, c);
      sinPasarPorLaListaPelada(c, urls);
      expect(page.url()).toContain(filtroDe(c));
    });

    test(`${c.rol}: con el atrás del navegador la lista conserva el filtro sin parpadeo`, async ({ abrir }) => {
      const page = await abrir(c.rol, c.filtrada);
      await vistaGuardada(page, c);
      await c.abrir(page);
      await page.waitForURL((u) => u.pathname !== new URL(c.lista, "http://x").pathname);
      const urls = seguirUrls(page);
      await page.goBack();
      await enLista(page, c);
      sinPasarPorLaListaPelada(c, urls);
      expect(page.url()).toContain(filtroDe(c));
    });

    test(`${c.rol}: tocando la barra inferior (sin recargar) la lista se abre ya filtrada`, async ({ abrir }) => {
      const page = await abrir(c.rol, c.filtrada);
      await vistaGuardada(page, c);
      // Desde otra pantalla del módulo, vuelta a la lista por la barra inferior.
      await page.goto(c.otra);
      const urls = seguirUrls(page);
      await page.getByRole("link", { name: c.nav, exact: true }).last().click();
      await enLista(page, c);
      sinPasarPorLaListaPelada(c, urls);
    });

    test(`${c.rol}: tocar de nuevo la pestaña en la que ya está no deja la pantalla cargando; sube al inicio`, async ({ abrir }) => {
      const page = await abrir(c.rol, c.filtrada);
      await vistaGuardada(page, c);
      const antes = page.url();
      await page.evaluate(() => window.scrollTo(0, 400));
      for (let i = 0; i < 2; i++) await page.getByRole("link", { name: c.nav, exact: true }).last().click();
      await expect(page.getByRole("progressbar", { name: "Cargando" })).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-cargando");
      expect(page.url()).toBe(antes);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    });

    test(`${c.rol}: desde la barra inferior la lista se abre ya filtrada`, async ({ abrir }) => {
      const page = await abrir(c.rol, c.filtrada);
      await vistaGuardada(page, c);
      await page.goto("/avisos");
      const urls = seguirUrls(page);
      await page.goto(c.lista);
      await enLista(page, c);
      sinPasarPorLaListaPelada(c, urls);
      expect(page.url()).toContain(filtroDe(c));
    });
  });
}

test.describe("@navegacion apertura y pestañas", () => {
  test("al abrir la app en «/» va directo a la última pantalla, sin pasar por una en blanco", async ({ abrir }) => {
    const page = await abrir("logistica", `/logistica?tipo=OC&obra=${obraLog}`);
    await expect.poll(() => page.evaluate(() => document.cookie.includes("prod1_ultima"))).toBe(true);
    const urls = seguirUrls(page);
    await page.goto("/");
    await page.waitForURL((u) => u.pathname === "/logistica");
    expect(urls, `pasó por «/»: ${urls.join(" → ")}`).not.toContain("/");
  });

  for (const [rol, ruta, pestana] of [
    ["logistica", "/logistica?tipo=OC", "Tesorería"],
    ["tesoreria", `/tesoreria?empresa=${empresaTes}&area=log`, "Pagado"],
    ["gerencia", "/gerencia/obras?tab=bor", "Publicadas"],
  ] as [Rol, string, string][]) {
    test(`${rol}: cambiar de pestaña no reemplaza la pantalla por el esqueleto de carga`, async ({ abrir }) => {
      const page = await abrir(rol, ruta);
      await page.evaluate(() => {
        const w = window as unknown as { esqueleto: number };
        w.esqueleto = 0;
        new MutationObserver(() => {
          if (document.querySelector('[aria-busy="true"][aria-label="Cargando"]')) w.esqueleto++;
        }).observe(document.body, { childList: true, subtree: true });
      });
      const antes = page.url();
      await page.getByRole("tab", { name: pestana }).or(page.getByRole("link", { name: pestana, exact: true })).first().click();
      await page.waitForURL((u) => u.href !== antes);
      // Hasta que llegue la pantalla de la otra pestaña (la barra de carga se apaga). No se espera a la red
      // quieta: el prefetch de un enlace de la barra inferior que el proxy redirige a su vista guardada
      // queda abierto en el navegador (Next no termina de leerlo), sin efecto en la navegación.
      await expect(page.getByRole("progressbar", { name: "Cargando" })).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { esqueleto: number }).esqueleto)).toBe(0);
    });
  }
});
