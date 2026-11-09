import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1 } from "./lib";

// Tesorería: presupuesto en tabla (/tesoreria/consultas) y bandejas de pagos con «Todas».
// Solo lectura (no paga ni rechaza). Los casos se toman de la base al cargar el archivo.
const soles = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number | string) => soles.format(Number(n));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PASO = 100;

// Obra con más partidas compradas; las dos obras de nombre más largo; empresa con más tipos de documento.
const [OBRA, LARGAS, EMPRESA] = sql(`
  select
    (select a.obra_id from v_avance_partida a join v_oc_items v on v.partida_id = a.partida_id and v.estado <> 'ANULADA'
       group by 1 order by count(distinct a.partida_id) desc limit 1),
    (select string_agg(id::text, ',') from (select o.id from obras o where exists (select 1 from v_avance_partida a where a.obra_id = o.id)
       order by length(o.nombre) desc, o.id limit 2) x),
    (select empresa_id from v_por_pagar group by 1 order by count(distinct doc) desc, count(*) desc limit 1)`)[0];

const CONSULTAS = "/tesoreria/consultas";
const filas = (page: Page) => page.locator("main button[aria-expanded]");
// El historial abre la vista de pago de Tesorería (como desde Pagos).
const historial = (page: Page) => page.locator('main a[href^="/tesoreria/pago/"]');
// La tabla se separa por pestañas de rubro; sin parámetro abre Material.
const MAT = "and a.rubro = 'MATERIAL'";
const TABS = { MATERIAL: "Material", "MANO OBRA": "M. de obra", SUBCONTRATO: "Subcontrato" } as const;

type Partida = { etapa: string; presupuestado: number; comprado: number; parcial: number; monto: number };
/** Partidas de la obra en el orden de la pantalla (etapa por su orden, luego partida_id). */
function partidas(obra: string, donde = ""): Partida[] {
  return sql(
    `select a.etapa, a.presupuestado, a.comprado, a.parcial, a.monto_comprado from v_avance_partida a left join etapas e on e.codigo = a.etapa
     where a.obra_id = ${obra} ${donde} order by coalesce(e.orden, 999), a.etapa, a.partida_id`,
  ).map(([etapa, p, c, par, m]) => ({ etapa, presupuestado: +p, comprado: +c, parcial: +par, monto: +m }));
}

test.describe("@tesoreria consultas en tabla", () => {
  test("empresa, obra, filtros, rubro, buscador y cabecera siguen fijos al desplazar", async ({ abrir }) => {
    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    await expect(filas(page)).toHaveCount(partidas(OBRA, MAT).length);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
    const g = await page.evaluate(() => {
      const barra = [...document.querySelectorAll("main > div")].find((d) => getComputedStyle(d).position === "sticky")!;
      // Lo que se ve en el centro de cada control es el control mismo (no una fila que pasa por encima).
      const arriba = (e: Element) => {
        const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      };
      const controles = [
        document.querySelector('main button[aria-label^="Empresa:"]')!,
        document.querySelector('main button[aria-label="Obra"]')!,
        document.querySelector('main button[aria-label^="Filtros"]')!,
        document.querySelector('main [role="tablist"]')!,
        document.querySelector('main input[type="search"]')!,
      ];
      const cabecera = barra.lastElementChild!;
      return {
        y: scrollY,
        pegada: Math.round(barra.getBoundingClientRect().top) - Math.round(document.querySelector("header")!.getBoundingClientRect().bottom),
        visibles: [...controles, cabecera].map(arriba),
        cabecera: (cabecera as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      };
    });
    expect(g.y, "no se desplazó").toBeGreaterThan(800);
    expect(Math.abs(g.pegada), "la barra no queda pegada bajo la barra superior").toBeLessThanOrEqual(1);
    expect(g.visibles, "empresa, obra, filtros, pestañas, buscador y cabecera visibles y sin tapar").toEqual([true, true, true, true, true, true]);
    expect(g.cabecera).toBe("Descripción Cantidad Monto");
    for (const b of [page.getByRole("button", { name: /^Empresa:/ }), page.getByRole("button", { name: "Obra", exact: true }), page.getByRole("button", { name: /^Filtros/ })])
      await expect(b).toBeInViewport();
  });

  for (const obra of LARGAS.split(",")) {
    test(`sin desborde con el nombre largo de la obra ${obra}`, async ({ abrir, revisarPantalla }) => {
      const nombre = sql1(`select nombre from obras where id = ${obra}`);
      const page = await abrir("tesoreria", `${CONSULTAS}?obra=${obra}&etapa=*&rubro=MATERIAL`);
      await expect(page.getByRole("button", { name: "Obra", exact: true })).toHaveText(nombre);
      await revisarPantalla(page);
      const ancho = page.viewportSize()!.width;
      const controles = {
        Empresa: page.getByRole("button", { name: /^Empresa:/ }),
        Obra: page.getByRole("button", { name: "Obra", exact: true }),
        Filtros: page.getByRole("button", { name: /^Filtros/ }),
      };
      for (const [n, l] of Object.entries(controles)) {
        const b = (await l.boundingBox())!;
        expect(b.x, `${n} sale por la izquierda`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${n} sale por la derecha`).toBeLessThanOrEqual(ancho);
      }
    });
  }

  test("filas, subtotales al pie de cada etapa y total de lo filtrado iguales a v_avance_partida", async ({ abrir }) => {
    const esperado = partidas(OBRA, MAT);
    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    await expect(filas(page)).toHaveCount(esperado.length);
    // Subtotal como lo suma la pantalla (en el mismo orden), para no diferir en el redondeo.
    const etapas = new Map<string, { n: number; comprado: number; total: number }>();
    for (const p of esperado) {
      const e = etapas.get(p.etapa) ?? { n: 0, comprado: 0, total: 0 };
      etapas.set(p.etapa, { n: e.n + 1, comprado: e.comprado + p.monto, total: e.total + p.parcial });
    }
    const ui = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll("main button[aria-expanded]")].map((b) => b.parentElement!))].map((panel) => {
        const titulo = panel.firstElementChild!.textContent!.trim();
        const pie = panel.lastElementChild!;
        const [comprado, total] = [...pie.children[2].children].map((s) => s.lastChild!.textContent!.trim());
        return `${titulo}: ${panel.querySelectorAll(":scope > button").length} filas, ${pie.children[0].textContent!.trim()}, ${comprado} de ${total}`;
      }),
    );
    expect(ui).toEqual([...etapas].map(([e, x]) => `${e}: ${x.n} filas, Subtotal ${e}, ${money(x.comprado)} de ${money(x.total)}`));
    // Total de lo filtrado, fijo abajo.
    const comprado = esperado.reduce((a, p) => a + p.monto, 0);
    const total = esperado.reduce((a, p) => a + p.parcial, 0);
    const barra = page.getByText(`Total (${esperado.length} ítems)`);
    await expect(barra).toBeInViewport();
    await expect(barra.locator("..")).toContainText(`${money(comprado)}`);
    await expect(barra.locator("..")).toContainText(`${money(total)}`);
    // Unas filas sueltas: el monto comprado y el presupuestado de cada una.
    const montos = await filas(page).evaluateAll((bs) => bs.map((b) => (b.children[2] as HTMLElement).innerText.replace(/\s+/g, " ")));
    for (const i of [0, Math.floor(esperado.length / 2), esperado.length - 1])
      expect(montos[i], `fila ${i}`).toBe(`${money(esperado[i].monto)} ${money(esperado[i].parcial)}`);
  });

  test("Empresa limita las obras y el rubro va en pestañas con ícono: material, mano de obra y subcontrato", async ({ abrir }) => {
    const [empresa] = sql(
      "select o.empresa_id from obras o where exists (select 1 from partidas p where p.obra_id = o.id) group by 1 order by count(*) desc limit 1",
    )[0];
    const obras = sql(
      `select o.nombre from obras o where o.empresa_id = ${empresa} and exists (select 1 from partidas p where p.obra_id = o.id) order by o.nombre`,
    ).map((f) => f[0]);
    const page = await abrir("tesoreria", `${CONSULTAS}?empresa=${empresa}`);
    await page.getByRole("button", { name: "Obra", exact: true }).click();
    // Cada opción lleva debajo el nombre de su empresa.
    const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page.getByRole("listbox", { name: "Obra" }).getByRole("option")).toHaveText(obras.map((o) => new RegExp(`^${escapar(o)}`)));
    await page.keyboard.press("Escape");
    const pestanas = page.getByRole("tab");
    await expect(pestanas).toHaveText(Object.values(TABS));
    for (const t of await pestanas.all()) await expect(t.locator("svg")).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "Material" })).toHaveAttribute("aria-selected", "true");
  });

  test("Etapa por URL y cada pestaña de rubro frente a SQL", async ({ abrir }) => {
    const n = (w: string) => Number(sql1(`select count(*) from v_avance_partida where obra_id = ${OBRA} and ${w}`));
    const [etapa] = sql(`select etapa from v_avance_partida where obra_id = ${OBRA} and rubro = 'MATERIAL' group by 1 order by count(*) desc limit 1`)[0];
    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=${encodeURIComponent(etapa)}&rubro=MATERIAL`);
    await expect(filas(page)).toHaveCount(n(`etapa = '${etapa}' and rubro = 'MATERIAL'`));
    await expect(page.getByRole("button", { name: "Filtros (1 activos)" })).toBeVisible();
    await expect(page.locator("main h2.rotulo")).toHaveText([etapa]);

    // Cada pestaña muestra solo su rubro (todas las etapas).
    await page.goto(`${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    for (const [rubro, nombre] of Object.entries(TABS)) {
      await page.getByRole("tab", { name: nombre }).click();
      await expect(page.getByRole("tab", { name: nombre })).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL((u) => u.searchParams.get("rubro") === rubro);
      await expect(filas(page), nombre).toHaveCount(n(`rubro = '${rubro}'`));
    }
  });

  test("Filtros: varias etapas a la vez y estado de pago, iguales a SQL", async ({ abrir, revisarPantalla }) => {
    // Las dos etapas con más partidas de material de la obra.
    const dos = sql(
      `select etapa from v_avance_partida where obra_id = ${OBRA} and rubro = 'MATERIAL' group by 1 order by count(*) desc, 1 limit 2`,
    ).map((f) => f[0]);
    test.skip(dos.length < 2, "la obra tiene una sola etapa de material");
    const lista = dos.map((e) => `'${e}'`).join(",");
    // Lo pagado (OC pagada, en entrega o recibida) y lo que está en Tesorería, por partida.
    const pagos = `left join (select partida_id,
        sum(cantidad) filter (where estado in ('PAGADA','EN_ENTREGA','RECIBIDA')) pagado,
        sum(parcial) filter (where estado = 'EN_TESORERIA') porpagar
      from v_oc_items group by 1) v on v.partida_id = a.partida_id`;
    const cuenta = (w: string) =>
      Number(sql1(`select count(*) from v_avance_partida a ${pagos} where a.obra_id = ${OBRA} and a.rubro = 'MATERIAL' and a.etapa in (${lista}) and ${w}`));

    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    const hoja = page.getByRole("dialog", { name: "Filtros" });
    for (const e of dos) await hoja.getByRole("checkbox", { name: e, exact: true }).click();
    await expect(hoja.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await revisarPantalla(page);
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL((u) => (u.searchParams.get("etapa") ?? "").split(",").sort().join() === [...dos].sort().join());
    await expect(filas(page)).toHaveCount(cuenta("true"));
    await expect(page.locator("main h2.rotulo")).toHaveText(
      sql(`select codigo from etapas where codigo in (${lista}) order by orden`).map((f) => f[0]),
    );
    await expect(page.getByRole("button", { name: "Filtros (2 activos)" })).toBeVisible();

    const casos = [
      ["porpagar", "Por pagar", "coalesce(v.porpagar, 0) > 0.005"],
      ["parcial", "Pagado parcial", "coalesce(v.pagado, 0) > 0 and coalesce(v.pagado, 0) < a.presupuestado"],
      ["completo", "Pagado completo", "a.presupuestado > 0 and coalesce(v.pagado, 0) >= a.presupuestado"],
      ["sinpagar", "Sin pagar", "coalesce(v.pagado, 0) <= 0"],
    ] as const;
    let alguno = false;
    for (const [valor, nombre, w] of casos) {
      const n = cuenta(w);
      alguno ||= n > 0;
      await page.getByRole("button", { name: /^Filtros/ }).click();
      await hoja.getByRole("radio", { name: nombre }).click();
      await hoja.getByRole("button", { name: "Aplicar" }).click();
      await expect(page).toHaveURL((u) => u.searchParams.get("pago") === valor);
      await expect(filas(page), nombre).toHaveCount(n);
      await expect(page.getByRole("button", { name: "Filtros (3 activos)" })).toBeVisible();
    }
    expect(alguno, "ningún estado de pago tiene partidas").toBe(true);

    // Limpiar quita las etapas y el pago.
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await hoja.getByRole("button", { name: "Limpiar" }).click();
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL((u) => (u.searchParams.get("etapa") ?? "*") === "*" && !u.searchParams.has("pago"));
    await expect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
  });

  test("Empresa con logos: elegir una limita las obras y «Todas» vuelve a todas", async ({ abrir }) => {
    const conPresupuesto = "exists (select 1 from partidas p where p.obra_id = o.id)";
    const [empresa, nombre] = sql(
      `select o.empresa_id, e.nombre from obras o join empresas e on e.id = o.empresa_id where ${conPresupuesto} group by 1, 2 order by count(*) desc limit 1`,
    )[0];
    const obras = (w: string) => sql(`select o.nombre from obras o where ${w} ${conPresupuesto} order by o.nombre`).map((f) => f[0]);
    const empresas = sql(`select distinct e.nombre from obras o join empresas e on e.id = o.empresa_id where ${conPresupuesto} order by 1`).map((f) => f[0]);
    const page = await abrir("tesoreria", `${CONSULTAS}?empresa=*`);
    await page.getByRole("button", { name: "Empresa: todas" }).click();
    const hoja = page.getByRole("dialog", { name: "Empresa" });
    await expect(hoja.locator("li button")).toHaveText(["Todas", ...empresas]);
    await expect(hoja.getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    await hoja.getByRole("button", { name: nombre, exact: true }).click();
    await expect(page).toHaveURL((u) => u.searchParams.get("empresa") === empresa);
    await expect(page.getByRole("button", { name: `Empresa: ${nombre}` })).toBeVisible();
    const opciones = page.getByRole("listbox", { name: "Obra" }).getByRole("option");
    await page.getByRole("button", { name: "Obra", exact: true }).click();
    await expect(opciones).toHaveText(obras(`o.empresa_id = ${empresa} and`).map((o) => new RegExp(`^${esc(o)}`)));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: `Empresa: ${nombre}` }).click();
    await hoja.getByRole("button", { name: "Todas" }).click();
    await expect(page).toHaveURL((u) => (u.searchParams.get("empresa") ?? "*") === "*");
    await page.getByRole("button", { name: "Obra", exact: true }).click();
    await expect(opciones).toHaveCount(obras("").length);
  });

  test("el buscador no distingue mayúsculas ni tildes", async ({ abrir }) => {
    // La palabra con tilde más repetida en las descripciones de la obra.
    const palabra = sql1(`
      select w from (select regexp_split_to_table(descripcion, '[^[:alpha:]]+') w from v_avance_partida where obra_id = ${OBRA} and rubro = 'MATERIAL') x
      where w ~ '[ÁÉÍÓÚÑ]' and length(w) >= 5 group by 1 order by count(*) desc, 1 limit 1`);
    test.skip(!palabra, "la obra no tiene descripciones con tilde");
    const llano = palabra.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const n = Number(
      sql1(`select count(*) from v_avance_partida where obra_id = ${OBRA} and rubro = 'MATERIAL' and translate(lower(descripcion), 'áéíóúüñ', 'aeiouun') like '%${llano}%'`),
    );
    expect(n, `«${palabra}» en SQL`).toBeGreaterThan(0);
    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    const caja = page.getByRole("searchbox", { name: "Ítem" });
    for (const q of [llano, palabra.charAt(0) + palabra.slice(1).toLowerCase()]) {
      await caja.fill(q);
      await expect(page).toHaveURL((u) => u.searchParams.get("q") === q);
      await expect(filas(page), `buscar «${q}»`).toHaveCount(n);
    }
  });

  test("rojo solo con sobrecosto; verde solo completo y sin sobrecosto", async ({ abrir }) => {
    const esperado = partidas(OBRA, MAT).map((p) => {
      const sobre = p.monto > p.parcial + 0.005;
      const completo = p.comprado >= p.presupuestado - 0.0001 && p.presupuestado > 0;
      return `cantidad ${completo && !sobre ? "verde" : "neutra"}, monto ${sobre ? "rojo" : completo ? "verde" : "neutro"}`;
    });
    expect(esperado.some((e) => e.endsWith("rojo")) && esperado.some((e) => e.startsWith("cantidad verde")), "la obra no tiene los dos casos").toBe(true);
    const page = await abrir("tesoreria", `${CONSULTAS}?obra=${OBRA}&etapa=*&rubro=MATERIAL`);
    await expect(filas(page)).toHaveCount(esperado.length);
    const ui = await filas(page).evaluateAll((bs) =>
      bs.map((b) => {
        const cant = b.children[1].children[0].classList;
        const monto = b.children[2].children[0].classList;
        if (cant.contains("text-danger")) return "cantidad roja";
        return `cantidad ${cant.contains("text-ok") ? "verde" : "neutra"}, monto ${monto.contains("text-danger") ? "rojo" : monto.contains("text-ok") ? "verde" : "neutro"}`;
      }),
    );
    const malas = ui.flatMap((u, i) => (u === esperado[i] ? [] : [`fila ${i}: ${u} (esperado ${esperado[i]})`]));
    expect(malas.slice(0, 5), `${malas.length} filas con color equivocado`).toEqual([]);
  });

  // Partidas de descripción única en su etapa (para tocarlas por nombre): la de más órdenes vigentes
  // y una cuyas órdenes están todas anuladas (si hay).
  type Caso = { id: string; obra: string; etapa: string; rubro: string; descripcion: string };
  const casosHistorial = (): Record<string, Caso> =>
    Object.fromEntries(
      sql(`
        with a as (select partida_id, obra_id, etapa, rubro, descripcion, count(*) over (partition by obra_id, etapa, rubro, descripcion) dup
                   from v_avance_partida where rubro in ('MATERIAL', 'MANO OBRA', 'SUBCONTRATO')),
        h as (select a.partida_id, a.obra_id, a.etapa, a.rubro, a.descripcion, count(*) filter (where v.estado <> 'ANULADA') vigentes
              from a join v_oc_items v on v.partida_id = a.partida_id where a.dup = 1 group by 1, 2, 3, 4, 5)
        (select 'vigente', partida_id, obra_id, etapa, rubro, descripcion from h order by vigentes desc, partida_id limit 1)
        union all (select 'anulada', partida_id, obra_id, etapa, rubro, descripcion from h where vigentes = 0 order by partida_id limit 1)`,
      ).map(([k, id, obra, etapa, rubro, ...d]) => [k, { id, obra, etapa, rubro, descripcion: d.join("|") }]),
    );
  const urlEtapa = (c: Caso) => `${CONSULTAS}?obra=${c.obra}&etapa=${encodeURIComponent(c.etapa)}&rubro=${encodeURIComponent(c.rubro)}`;
  const desplegar = async (page: Page, descripcion: string) => {
    const fila = page.getByRole("button", { name: new RegExp(`^${esc(descripcion)}: comprado`) });
    if ((await fila.getAttribute("aria-expanded")) !== "true") await fila.click();
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    return fila;
  };

  test("historial de una partida igual a v_oc_items sin anuladas", async ({ abrir }) => {
    const { vigente: p, anulada } = casosHistorial();
    const esperado = sql(
      `select obra_id, numero_oc, parcial from v_oc_items where partida_id = ${p.id} and estado <> 'ANULADA' order by fecha desc, id desc`,
    ).map(([obra, numero, parcial]) => `/tesoreria/pago/${obra}/${encodeURIComponent(numero)}?desde=presupuesto ${numero} ${money(parcial)}`);
    const page = await abrir("tesoreria", urlEtapa(p));
    await desplegar(page, p.descripcion);
    await expect(historial(page)).toHaveCount(esperado.length);
    const ui = await historial(page).evaluateAll((as) =>
      as.map((a) => `${a.getAttribute("href")} ${a.children[0].children[0].textContent} ${a.children[2].children[0].textContent}`),
    );
    expect(ui).toEqual(esperado);

    // Una partida cuyas únicas órdenes están anuladas no muestra ninguna.
    if (anulada) {
      await page.goto(urlEtapa(anulada));
      await desplegar(page, anulada.descripcion);
      await expect(page.getByText("Sin órdenes")).toBeVisible();
      await expect(historial(page)).toHaveCount(0);
    }
  });

  test("el historial abre la vista de pago de la orden y «Volver» regresa con la fila abierta", async ({ abrir }) => {
    const p = casosHistorial().vigente;
    const page = await abrir("tesoreria", urlEtapa(p));
    const fila = await desplegar(page, p.descripcion);
    await expect(historial(page).first()).toBeVisible();
    const n = await historial(page).count();
    const href = (await historial(page).first().getAttribute("href"))!;
    await historial(page).first().click();
    await expect(page).toHaveURL(new RegExp(`${esc(href)}$`));
    const numero = decodeURIComponent(href.split("/").pop()!.split("?")[0]);
    await expect(page.locator("header").first()).toContainText(numero);
    await page.getByRole("button", { name: "Volver" }).click();
    await expect(page).toHaveURL((u) => u.pathname === CONSULTAS);
    await expect(fila).toHaveAttribute("aria-expanded", "true");
    await expect(historial(page)).toHaveCount(n);
  });
});

test.describe("@tesoreria bandejas", () => {
  const SECCIONES = { OC: "Órdenes de compra", OS: "Órdenes de servicio", OP: "Órdenes de pago" } as const;
  type Doc = keyof typeof SECCIONES;
  const seccion = (page: Page, doc: Doc) => page.locator(`main section[aria-label="${SECCIONES[doc]}"]`);
  const ESTADOS = { pend: ["Por pagar", "PENDIENTE", "saldo"], pag: ["Pagado", "PAGADO", "pagado"], rec: ["Rechazos", "", ""] } as const;
  type Est = keyof typeof ESTADOS;

  /** Conteo y suma de cada tipo de documento según la base (`donde`: filtro SQL extra). */
  function totales(est: Est, donde = ""): Record<Doc, { n: number; suma: number }> {
    const [, estado, col] = ESTADOS[est];
    const filas =
      est === "rec"
        ? sql(`select doc, count(*), 0 from v_rechazos where true ${donde} group by 1`)
        : sql(`select doc, count(*), coalesce(sum(${col}), 0) from v_por_pagar where estado = '${estado}' ${donde} group by 1`);
    const t = { OC: { n: 0, suma: 0 }, OS: { n: 0, suma: 0 }, OP: { n: 0, suma: 0 } };
    for (const [doc, n, suma] of filas) if (doc in t) t[doc as Doc] = { n: +n, suma: +suma };
    return t;
  }

  /** Cabecera de cada sección (o su ausencia) igual a la base. */
  async function revisarSecciones(page: Page, est: Est, docs: Doc[], t: Record<Doc, { n: number; suma: number }>) {
    for (const doc of Object.keys(SECCIONES) as Doc[]) {
      const s = seccion(page, doc);
      if (!docs.includes(doc) || t[doc].n === 0) {
        await expect(s, `sección ${doc} de más`).toHaveCount(0);
        continue;
      }
      const cab = s.locator("h2 > span");
      await expect(cab.first(), `${doc} en ${ESTADOS[est][0]}`).toHaveText(`${doc} ${t[doc].n}`);
      if (est === "rec") await expect(cab, "Rechazos no lleva suma").toHaveCount(1);
      else await expect(cab.nth(1), `suma ${doc} en ${ESTADOS[est][0]}`).toHaveText(`S/ ${money(t[doc].suma)}`);
    }
  }

  // Prod 1: sin Contabilidad no hay órdenes de pago; la bandeja es siempre la de Logística (OC | OS).
  test("entrada: se elige la empresa (o «Todas») y se va directo a la bandeja de OC / OS", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria");
    await expect(page.locator("main li a")).toHaveCount(Number(sql1("select count(*) from empresas")) + 1);
    await page.getByRole("link", { name: "Todas", exact: true }).click();
    // La bandeja de todas las empresas es la consulta más pesada: la URL cambia cuando llega su respuesta.
    await expect(page).toHaveURL((u) => u.searchParams.get("empresa") === "todas" && u.searchParams.get("area") === "log", { timeout: 20_000 });
    await expect(page.getByRole("tab", { name: "Por pagar" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "OC", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: /^Envía/ })).toHaveCount(0);
  });

  for (const est of Object.keys(ESTADOS) as Est[]) {
    test(`empresa «Todas» en ${ESTADOS[est][0]}: conteo y suma de OC y de OS iguales a SQL`, async ({ abrir }) => {
      const page = await abrir("tesoreria", `/tesoreria?empresa=todas&area=log&est=${est}`);
      await revisarSecciones(page, est, ["OC"], totales(est));
      await page.getByRole("tab", { name: "OS", exact: true }).click();
      await expect(page).toHaveURL((u) => u.searchParams.get("doc") === "OS");
      await revisarSecciones(page, est, ["OS"], totales(est));
    });
  }

  test("una empresa concreta: OC y OS iguales a SQL", async ({ abrir }) => {
    const nombre = sql1(`select nombre from empresas where id = ${EMPRESA}`);
    const de = `and empresa_id = ${EMPRESA}`;
    const page = await abrir("tesoreria", `/tesoreria?empresa=${EMPRESA}&area=log&est=pag`);
    await expect(page.getByRole("button", { name: `Empresa: ${nombre}` })).toBeVisible();
    await revisarSecciones(page, "pag", ["OC"], totales("pag", de));
    await page.getByRole("tab", { name: "OS", exact: true }).click();
    await expect(page).toHaveURL((u) => u.searchParams.get("doc") === "OS");
    await revisarSecciones(page, "pag", ["OS"], totales("pag", de));
  });

  test("sin órdenes de pago: un enlace viejo con área Contabilidad o «Todas» muestra solo OC / OS", async ({ abrir }) => {
    for (const area of ["con", "todas"]) {
      const page = await abrir("tesoreria", `/tesoreria?empresa=todas&area=${area}&est=pag`);
      await expect(seccion(page, "OP")).toHaveCount(0);
      await revisarSecciones(page, "pag", ["OC"], totales("pag"));
    }
  });

  test("Obra arriba, junto a la empresa: con «Todas» lista las obras de todas las empresas y filtra igual que SQL", async ({ abrir }) => {
    const obras = sql("select nombre from obras order by nombre").map(([n]) => n);
    expect(Number(sql1("select count(distinct empresa_id) from obras")), "la base tiene obras de una sola empresa").toBeGreaterThan(1);
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
    // Empresa, obra y filtros en una fila, como en el presupuesto; la obra ya no va dentro de Filtros.
    const fila = await Promise.all(
      [page.getByRole("button", { name: "Empresa: todas" }), page.getByRole("button", { name: "Obra", exact: true }), page.getByRole("button", { name: /^Filtros/ })].map(
        async (b) => (await b.boundingBox())!,
      ),
    );
    expect(new Set(fila.map((b) => Math.round(b.y))).size, "no están en una sola fila").toBe(1);
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await expect(page.locator("dialog[open]").getByRole("button", { name: "Obra", exact: true })).toHaveCount(0);
    await page.locator("dialog[open]").getByRole("button", { name: "Cerrar" }).click();

    await page.getByRole("button", { name: "Obra", exact: true }).click();
    const opciones = page.getByRole("listbox", { name: "Obra" }).getByRole("option");
    await expect(opciones).toHaveText(["Todas las obras", ...obras]);
    // Filtrar por una obra de una empresa distinta a la primera da lo mismo que SQL.
    const [obra, nombre] = sql(`select v.obra_id, o.nombre from v_por_pagar v join obras o on o.id = v.obra_id
                       where v.estado = 'PAGADO' and v.doc = 'OC' and v.empresa_id <> (select min(empresa_id) from v_por_pagar where estado = 'PAGADO')
                       group by 1, 2 order by count(*) desc limit 1`)[0];
    await opciones.filter({ hasText: new RegExp(`^${esc(nombre)}$`) }).click();
    await expect(page).toHaveURL((u) => u.searchParams.get("obra") === obra);
    await expect(page.getByRole("button", { name: "Obra", exact: true })).toHaveText(nombre);
    await revisarSecciones(page, "pag", ["OC"], totales("pag", `and obra_id = ${obra}`));
  });

  test("Filtros como en el presupuesto: secciones, varias etapas y monto con su contador, iguales a SQL", async ({ abrir }) => {
    const [e1, e2] = sql(`select e from (select unnest(etapas) e, count(*) n from v_por_pagar where estado = 'PAGADO' and doc = 'OC' group by 1) x
                          order by n desc, e limit 2`).map(([e]) => e);
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    const hoja = page.getByRole("dialog", { name: "Filtros" });
    for (const s of ["Ordenar por", "Fecha", "Monto", "Proveedor", "Etapas"]) await expect(hoja.getByRole("region", { name: s })).toBeVisible();
    await hoja.getByRole("checkbox", { name: e1, exact: true }).click();
    await hoja.getByRole("checkbox", { name: e2, exact: true }).click();
    await expect(hoja.getByRole("region", { name: "Etapas" })).toContainText("2 de");
    await hoja.getByRole("radio", { name: "De 1,000 a 10,000" }).click();
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL((u) => new Set(u.searchParams.get("etapa")?.split(",")).size === 2 && u.searchParams.get("monto") === "medio");
    await expect(page.getByRole("button", { name: "Filtros (3 activos)" })).toBeVisible();
    await revisarSecciones(page, "pag", ["OC"], totales("pag", `and etapas && array['${e1}', '${e2}'] and pagado >= 1000 and pagado < 10000`));
    // Limpiar deja todo como al entrar.
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await hoja.getByRole("button", { name: "Limpiar" }).click();
    await hoja.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL((u) => !u.searchParams.has("etapa") && !u.searchParams.has("monto"));
    await expect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
  });

  test("elegir otra empresa por su logo quita la obra elegida y limita las obras a esa empresa", async ({ abrir }) => {
    const [obra] = sql(`select obra_id from v_por_pagar where estado = 'PAGADO' and empresa_id = ${EMPRESA} group by 1 order by count(*) desc limit 1`)[0];
    const [otra, nombreOtra] = sql(`select e.id, e.nombre from empresas e where e.id <> ${EMPRESA} and exists (select 1 from obras o where o.empresa_id = e.id) order by e.id limit 1`)[0];
    const page = await abrir("tesoreria", `/tesoreria?empresa=${EMPRESA}&area=log&est=pag&obra=${obra}`);
    await page.getByRole("button", { name: /^Empresa:/ }).click();
    await page.getByRole("dialog", { name: "Empresa" }).getByRole("button", { name: nombreOtra, exact: true }).click();
    await expect(page).toHaveURL((u) => u.searchParams.get("empresa") === otra && !u.searchParams.has("obra"));
    await expect(page.getByRole("button", { name: `Empresa: ${nombreOtra}` })).toBeVisible();
    await page.getByRole("button", { name: "Obra", exact: true }).click();
    const obras = sql(`select nombre from obras where empresa_id = ${otra} order by nombre`).map(([n]) => n);
    await expect(page.getByRole("listbox", { name: "Obra" }).getByRole("option")).toHaveText(["Todas las obras", ...obras]);
  });

  test("botón de diseño a la izquierda de la campana: cada diseño con su miniatura y los mismos totales", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
    const boton = page.getByRole("button", { name: /^Diseño/ });
    await expect(boton).toHaveAccessibleName("Diseño: Lista");
    const [b, c] = [(await boton.boundingBox())!, (await page.getByRole("link", { name: /^Avisos/ }).or(page.getByRole("button", { name: /^Avisos/ })).boundingBox())!];
    expect(b.x + b.width, "el botón va justo antes de la campana").toBeLessThanOrEqual(c.x + 1);
    const t = totales("pag");
    const n = await seccion(page, "OC").locator("li a").count();
    const DISENOS = ["Lista", "Compacta", "Tarjetas", "Tabla", "Mosaico", "Por obra", "Por proveedor", "Por fecha", "Por etapa", "Por empresa", "Por monto"];
    await boton.click();
    const opciones = page.getByRole("dialog", { name: "Diseño" }).getByRole("radio");
    await expect(opciones).toHaveText(DISENOS);
    // Cada opción lleva una miniatura del diseño, y las miniaturas son distintas entre sí.
    const miniaturas = await opciones.evaluateAll((os) => os.map((o) => o.querySelector("[data-miniatura]")?.innerHTML ?? ""));
    expect(miniaturas.every(Boolean), "falta alguna miniatura").toBe(true);
    expect(new Set(miniaturas).size, "miniaturas repetidas").toBe(DISENOS.length);
    await page.getByRole("dialog", { name: "Diseño" }).getByRole("button", { name: "Cerrar" }).click();
    for (const d of [...DISENOS.slice(1), "Lista"]) {
      await boton.click();
      await page.getByRole("dialog", { name: "Diseño" }).getByRole("radio", { name: d }).click();
      await expect(boton).toHaveAccessibleName(`Diseño: ${d}`);
      if (d.startsWith("Por ")) await expect(seccion(page, "OC").locator("h3").first()).toBeVisible();
      else await expect(seccion(page, "OC").locator("h3")).toHaveCount(0);
      await revisarSecciones(page, "pag", ["OC"], t);
      // En «Por etapa» un documento que toca varias etapas sale en cada una: se cuentan documentos distintos.
      if (d === "Por etapa")
        expect(new Set(await seccion(page, "OC").locator("li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).size, d).toBe(n);
      else await expect(seccion(page, "OC").locator("li a"), d).toHaveCount(n);
    }
    // Se recuerda: al recargar sigue el último elegido.
    await boton.click();
    await page.getByRole("dialog", { name: "Diseño" }).getByRole("radio", { name: "Compacta" }).click();
    await expect(boton).toHaveAccessibleName("Diseño: Compacta");
    await expect.poll(() => page.evaluate(() => document.cookie.includes("prod1_diseno_pagos=compacta"))).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "Diseño: Compacta" })).toBeVisible();
  });

  for (const [diseno, nombre, col] of [
    ["obra", "Por obra", "obra"],
    ["proveedor", "Por proveedor", "proveedor"],
    ["empresa", "Por empresa", "empresa"],
  ] as const) {
    test(`${nombre}: cada grupo con la cantidad y la suma según SQL`, async ({ abrir }) => {
      const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
      await page.context().addCookies([{ name: "prod1_diseno_pagos", value: diseno, url: new URL(page.url()).origin }]);
      await page.reload();
      const grupos = seccion(page, "OC").locator("h3");
      await expect(grupos.first()).toBeVisible();
      const esperado = new Map(
        sql(`select ${col}, count(*), coalesce(sum(pagado), 0) from v_por_pagar where estado = 'PAGADO' and doc = 'OC' group by 1`).map(([o, n, s]) => [o, `${o} ${n}|S/ ${money(s)}`]),
      );
      for (const g of await grupos.all()) {
        const [titulo, suma] = await g.locator(":scope > span").allTextContents();
        const clave = titulo.replace(/\s\d+$/, "");
        expect(`${titulo}|${suma}`, clave).toBe(esperado.get(clave));
      }
    });
  }

  test("Por etapa: documentos distintos por etapa según SQL, y las sumas por etapa cuadran con la de la sección", async ({ abrir }) => {
    // Una obra con menos de una página de documentos (así se ven todas sus etapas) y alguno en varias etapas.
    const obra = sql1(`select v.obra_id from v_por_pagar v where v.estado = 'PAGADO' and v.doc = 'OC' group by 1
                       having count(*) < 100 and bool_or(cardinality(v.etapas) > 1) order by count(*) desc limit 1`);
    const page = await abrir("tesoreria", `/tesoreria?empresa=todas&area=log&est=pag&obra=${obra}`);
    await page.context().addCookies([{ name: "prod1_diseno_pagos", value: "etapa", url: new URL(page.url()).origin }]);
    await page.reload();
    const grupos = seccion(page, "OC").locator("h3");
    await expect(grupos.first()).toBeVisible();
    const esperado = new Map(
      sql(`select l.etapa, count(distinct (v.obra_id, v.numero)) from v_por_pagar v join v_oc_items l on l.obra_id = v.obra_id and l.numero_oc = v.numero
           where v.estado = 'PAGADO' and v.doc = 'OC' and v.obra_id = ${obra} group by 1`).map(([e, n]) => [e, `${e} ${n}`]),
    );
    const numero = (t: string) => Number(t.replace(/[^\d.]/g, ""));
    let suma = 0;
    for (const g of await grupos.all()) {
      const [titulo, monto] = await g.locator(":scope > span").allTextContents();
      expect(titulo, titulo).toBe(esperado.get(titulo.replace(/\s\d+$/, "")));
      suma += numero(monto);
    }
    expect(await grupos.count()).toBe(esperado.size);
    const total = Number(sql1(`select coalesce(sum(pagado), 0) from v_por_pagar where estado = 'PAGADO' and doc = 'OC' and obra_id = ${obra}`));
    expect(Math.abs(suma - total), "la suma de las etapas no cuadra con la sección").toBeLessThan(0.01 * esperado.size + 0.01);
  });

  test("Tarjetas: pago parcial con su barra y «Falta guía» en Por pagar", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pend");
    await page.context().addCookies([{ name: "prod1_diseno_pagos", value: "tarjetas", url: new URL(page.url()).origin }]);
    await page.reload();
    const tarjetas = seccion(page, "OC").locator("li a");
    await expect(tarjetas.first()).toBeVisible();
    const [faltan, parciales] = sql(`select count(*) filter (where falta_guia), count(*) filter (where pagado > 0)
                                     from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC'`)[0].map(Number);
    const n = await tarjetas.count();
    test.skip(n < Number(sql1("select count(*) from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC'")), "Por pagar tiene más de una página");
    await expect(tarjetas.filter({ hasText: "Falta guía" })).toHaveCount(faltan);
    await expect(tarjetas.filter({ hasText: /^.*Pagado S\/ [\d,.]+ de S\/ [\d,.]+/ })).toHaveCount(parciales);
  });

  test("tocar una OC de Pagado mientras carga «más» termina abriéndola", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&est=pag");
    const carga = page.locator("main [role=status]");
    test.skip((await carga.count()) === 0, "Pagado no tiene más de una página");
    // La carga de la página siguiente tarda 2 s: el toque cae seguro mientras está pendiente.
    await page.route(
      (u) => u.pathname === "/tesoreria" && u.searchParams.get("n") === String(2 * PASO),
      async (r) => {
        await new Promise((ok) => setTimeout(ok, 2_000));
        await r.continue().catch(() => {});
      },
    );
    const op = seccion(page, "OC").locator("li a").last();
    const href = (await op.getAttribute("href"))!;
    await op.scrollIntoViewIfNeeded();
    await expect(carga).toHaveText("Cargando…");
    await op.tap();
    await expect(page).toHaveURL(new RegExp(`${esc(href)}$`), { timeout: 12_000 });
    const numero = decodeURIComponent(href.split("/").pop()!.split("?")[0]);
    await expect(page.locator("header").first()).toContainText(numero);
  });
});

test.describe("@tesoreria cuántos hay en cada pestaña", () => {
  test("OC / OS (todo el documento: por pagar, pagado y rechazos) y Por pagar / Pagado / Rechazos llevan su circulito con lo mismo que la base", async ({ abrir }) => {
    const page = await abrir("tesoreria", "/tesoreria?empresa=todas&area=log&doc=OC&est=pend");
    const n = (q: string) => Number(sql1(q));
    const total = (doc: string) => n(`select (select count(*) from v_por_pagar where doc = '${doc}') + (select count(*) from v_rechazos where doc = '${doc}')`);
    const esperado: [string, number][] = [
      ["OC", total("OC")],
      ["OS", total("OS")],
      ["Por pagar", n("select count(*) from v_por_pagar where estado = 'PENDIENTE' and doc = 'OC'")],
      ["Pagado", n("select count(*) from v_por_pagar where estado = 'PAGADO' and doc = 'OC'")],
      ["Rechazos", n("select count(*) from v_rechazos where doc = 'OC'")],
    ];
    for (const [pestana, total] of esperado) {
      const circulo = page.getByRole("tab", { name: pestana, exact: true }).locator("[data-cuenta]");
      if (total) await expect(circulo, pestana).toHaveAttribute("data-cuenta", total > 999 ? "999+" : String(total));
      else await expect(circulo, pestana).toHaveCount(0);
    }
  });
});

test.describe("@tesoreria empresa y obra compartidas entre Pagos y Presupuesto", () => {
  // Dos obras con presupuesto y órdenes en Tesorería, de empresas distintas si las hay.
  const [[O1, E1, N1, NE1], [O2, E2, N2, NE2]] = sql(`
    with c as (select o.id, o.empresa_id, o.nombre, e.nombre empresa, count(*) n from obras o join empresas e on e.id = o.empresa_id
               join v_por_pagar v on v.obra_id = o.id where exists (select 1 from partidas p where p.obra_id = o.id) group by 1, 2, 3, 4)
    (select id, empresa_id, nombre, empresa from c order by n desc limit 1)
    union all
    (select id, empresa_id, nombre, empresa from c order by (empresa_id = (select empresa_id from c order by n desc limit 1)), n desc limit 1 offset 0)`);
  const obra = (page: Page) => page.getByRole("button", { name: "Obra", exact: true });

  test("lo elegido en Pagos abre igual el Presupuesto, y lo elegido en el Presupuesto abre igual Pagos", async ({ abrir }) => {
    expect(O1, "hacen falta dos obras distintas").not.toBe(O2);
    const page = await abrir("tesoreria", `/tesoreria?empresa=${E1}&area=log&obra=${O1}`);
    await page.getByRole("link", { name: "Presupuesto", exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === "/tesoreria/consultas" && u.searchParams.get("empresa") === E1 && u.searchParams.get("obra") === O1);
    await expect(obra(page)).toHaveText(N1);
    await expect(page.getByRole("button", { name: `Empresa: ${NE1}` })).toBeVisible();

    // Ahora se cambia en el Presupuesto y se vuelve a Pagos.
    await page.getByRole("button", { name: /^Empresa:/ }).click();
    await page.getByRole("dialog", { name: "Empresa" }).getByRole("button", { name: NE2, exact: true }).click();
    await expect(page.getByRole("button", { name: `Empresa: ${NE2}` })).toBeVisible();
    await obra(page).click();
    await page.getByRole("listbox", { name: "Obra" }).getByRole("option").filter({ hasText: new RegExp(`^${esc(N2)}`) }).click();
    await expect(page).toHaveURL((u) => u.searchParams.get("obra") === O2);
    await page.getByRole("link", { name: "Pagos", exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === "/tesoreria" && u.searchParams.get("empresa") === E2 && u.searchParams.get("obra") === O2);
    await expect(obra(page)).toHaveText(N2);
    await expect(page.getByRole("button", { name: `Empresa: ${NE2}` })).toBeVisible();
  });

  test("con «Todas las obras» en Pagos, el Presupuesto toma la empresa y conserva su obra", async ({ abrir }) => {
    const page = await abrir("tesoreria", `/tesoreria/consultas?empresa=${E1}&obra=${O1}`);
    await expect.poll(() => page.evaluate(() => document.cookie.includes("prod1_vistas"))).toBe(true);
    await page.goto("/tesoreria?empresa=todas&area=log");
    await expect(obra(page)).toHaveText("Todas las obras");
    await page.getByRole("link", { name: "Presupuesto", exact: true }).click();
    await expect(page).toHaveURL((u) => u.pathname === "/tesoreria/consultas" && u.searchParams.get("empresa") === "*" && u.searchParams.get("obra") === O1);
    await expect(page.getByRole("button", { name: "Empresa: todas" })).toBeVisible();
    await expect(obra(page)).toHaveText(N1);
  });
});
