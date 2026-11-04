import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1 } from "./lib";

// Comprobaciones funcionales por rol que antes se hacían a mano (auditorías r8/r9). Solo lectura:
// no se envía ningún formulario. Los datos se toman de la base al correr cada prueba.
//   ERP_DEMO=… ERP_PASS=… npx playwright test --grep @roles

/** Contraste WCAG de cada elemento contra el fondo que se pinta debajo (con opacidades). */
const contrastes = (loc: Locator) =>
  loc.evaluateAll((els) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    const pinta = (c: string) => {
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
    };
    const pix = () => [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const cadena: Element[] = [];
        for (let e: Element | null = el; e; e = e.parentElement) cadena.unshift(e);
        cx.clearRect(0, 0, 1, 1);
        pinta("#fff");
        let opacidad = 1;
        for (const e of cadena) {
          const cs = getComputedStyle(e);
          if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") pinta(cs.backgroundColor);
          opacidad *= parseFloat(cs.opacity);
        }
        const fondo = lum(pix());
        cx.globalAlpha = opacidad;
        pinta(getComputedStyle(el).color);
        cx.globalAlpha = 1;
        const [a, b] = [lum(pix()), fondo].sort((x, y) => y - x);
        return {
          texto: (el as HTMLElement).innerText.trim().slice(0, 30),
          px: parseFloat(getComputedStyle(el).fontSize),
          ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
        };
      });
  });

/** Tarjetas de entrega (EntregasPartida): con foto son botón con miniatura; sin foto, un div. */
const tarjetas = (raiz: Locator) =>
  raiz.locator(".w-24.shrink-0").evaluateAll((cs) =>
    cs.map((c) => ({ boton: c.tagName === "BUTTON", img: !!c.querySelector("img"), svg: c.querySelectorAll("svg").length, gris: !!c.querySelector(".bg-sunken") })),
  );

test.describe("@roles @logistica", () => {
  test("detalle: OS de valorización sin Entregas; OC recibida con sus entregas", async ({ abrir }) => {
    const [osObra, osNum] = sql("select obra_id, numero from ordenes_compra where valorizacion_id is not null and estado='RECIBIDA' order by obra_id, numero limit 1")[0];
    // OC recibida cuyas entregas tienen todas foto: cada entrega se ve como tarjeta bajo su ítem.
    const [ocObra, ocNum, lineas, entregas] = sql(
      "select o.obra_id, o.numero, (select count(*) from v_oc_items i where i.obra_id=o.obra_id and i.numero_oc=o.numero), " +
        "(select count(*) from entregas e where e.obra_id=o.obra_id and e.numero_oc=o.numero) from ordenes_compra o " +
        "where o.tipo='OC' and o.estado='RECIBIDA' and o.valorizacion_id is null " +
        "and exists (select 1 from entregas e where e.obra_id=o.obra_id and e.numero_oc=o.numero) " +
        "and not exists (select 1 from entregas e where e.obra_id=o.obra_id and e.numero_oc=o.numero and not exists (select 1 from entrega_fotos f where f.entrega_id=e.id)) " +
        "order by o.obra_id desc, o.numero limit 1",
    )[0];

    const page = await abrir("logistica", `/logistica/ordenes/${osObra}/${osNum}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator('section[aria-label="Entregas"]'), `OS ${osObra}/${osNum} de valorización`).toHaveCount(0);

    await page.goto(`/logistica/ordenes/${ocObra}/${ocNum}`);
    const sec = page.locator('section[aria-label="Entregas"]');
    await expect(sec, `OC ${ocObra}/${ocNum} recibida`).toBeVisible();
    await expect(sec.locator(":scope > ul > li"), "ítems de la OC").toHaveCount(Number(lineas));
    await expect(sec.locator(".w-24.shrink-0"), "entregas (SQL)").toHaveCount(Number(entregas));
  });
});

test.describe("@roles @logistica", () => {
  test("campana con número: 12 px y contraste ≥ 4.5", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica");
    // Sin avisos sin leer en la demo: se simula el conteo en la respuesta (no se escribe nada).
    await page.context().route("**/sb/rest/v1/notificaciones*", async (route) => {
      if (route.request().method() !== "HEAD") return route.continue();
      const r = await route.fetch();
      await route.fulfill({ response: r, headers: { ...r.headers(), "content-range": "*/7" } });
    });
    await page.reload();
    const num = page.locator('a[href="/avisos"] span.num').first();
    await expect(num).toHaveText("7");
    const [c] = await contrastes(num);
    expect(c.px, "tamaño del número").toBe(12);
    expect(c.ratio, "contraste del número").toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("@roles @gerencia", () => {
  test("seguimiento: la misma vista que el del Jefe de Operaciones", async ({ abrir }) => {
    const obra = sql1("select obra_id from entregas group by 1 order by count(*) desc limit 1");
    const ruta = (base: string) => `${base}?obra=${obra}&grupo=MATERIALES`;
    const ger = await abrir("gerencia", ruta("/gerencia/presupuesto"));
    const jefe = await abrir("jefe", ruta("/operaciones"));
    await expect(ger.locator("header").first()).toContainText("Seguimiento");
    await expect(ger.getByRole("tab")).toHaveText(["Materiales", "Mano de obra", "Subcontratos"]);
    await expect(ger.getByRole("link", { name: "Seguimiento", exact: true })).toBeVisible();
    // Lo mismo en las dos: el contenido de la pantalla (sin la barra superior ni la inferior).
    const texto = async (p: typeof ger) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
    expect(await texto(ger)).toBe(await texto(jefe));
  });
});

test.describe("@roles @tesoreria", () => {
  test("entrada: cada empresa con su logo que carga (o, si no tiene logo propio, su inicial)", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria?area=");
    const empresas = page.locator("main ul.grid-cols-2 > li:not(.col-span-2) > a");
    await expect(empresas.first()).toBeVisible();
    const fichas = await empresas.evaluateAll((as) =>
      Promise.all(
        as.map(async (a) => {
          const img = a.querySelector("img");
          await img?.decode().catch(() => {});
          return {
            nombre: a.lastChild?.textContent?.trim() ?? "",
            img: !!img,
            carga: !!img && img.complete && img.naturalWidth > 0,
            inicial: img ? "" : (a.firstElementChild as HTMLElement).innerText.trim(),
          };
        }),
      ),
    );
    const conLogo = (n: string) => ["png", "svg"].some((x) => fs.existsSync(path.resolve(`public/empresas/${n.toLowerCase()}.${x}`)));
    expect(fichas.length, "empresas en la entrada").toBeGreaterThan(1);
    for (const f of fichas) {
      if (conLogo(f.nombre)) expect(f.carga, `${f.nombre}: <img> que carga`).toBe(true);
      else expect({ img: f.img, inicial: f.inicial }, `${f.nombre}: su inicial, sin <img>`).toEqual({ img: false, inicial: f.nombre.charAt(0) });
    }
  });
});

test.describe("@roles @jefe", () => {
  test("plan y entregas: sin foto sin recuadro gris; con foto miniatura que abre el visor", async ({ abrir }) => {
    const porFoto = (con: boolean) =>
      sql(
        `select e.obra_id, p.grupo from entregas e join oc_items i on i.id=e.oc_item_id join v_seguimiento_partida p on p.partida_id=i.partida_id ` +
          `where ${con ? "" : "not "}exists (select 1 from entrega_fotos f where f.entrega_id=e.id) group by 1, 2 order by count(*) limit 1`,
      )[0];
    const [sinObra, sinGrupo] = porFoto(false);
    const [conObra, conGrupo] = porFoto(true);

    const page = await abrir("jefe", `/operaciones?obra=${sinObra}&grupo=${sinGrupo}`);
    const sin = (await tarjetas(page.locator("main"))).filter((t) => !t.img);
    expect(sin.length, `obra ${sinObra}: entregas sin foto`).toBeGreaterThan(0);
    expect(sin.filter((t) => t.boton || t.svg || t.gris), "sin foto: ni botón, ni ícono, ni recuadro gris").toEqual([]);

    await page.goto(`/operaciones?obra=${conObra}&grupo=${conGrupo}`);
    const mini = page.locator("main button.w-24.shrink-0").filter({ has: page.locator("img") }).first();
    await mini.scrollIntoViewIfNeeded();
    await expect.poll(() => mini.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), "miniatura cargada").toBe(true);
    await mini.click();
    const visor = page.locator('dialog[open][aria-label="Fotos"]');
    await expect(visor).toBeVisible();
    await expect.poll(() => visor.locator("img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), "foto en el visor").toBe(true);
  });
});
