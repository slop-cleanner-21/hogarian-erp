import { expect, test } from "./fixtures";
import { sesion, sql } from "./lib";

// Nueva OC / OS: lo avanzado se recuerda en el dispositivo si se sale de la pantalla (también en otra visita sin la obra en la
// URL), y la hoja de selección funciona en Samsung Internet.

const SAMSUNG = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36";

/** Una obra con partidas por pedir en OS. */
const partida = () =>
  sql(
    `select p.obra_id, p.descripcion from v_partidas p join obras o on o.id = p.obra_id
      where p.rubro <> 'MATERIAL' and o.presupuesto_estado = 'PUBLICADO' and o.estado <> 'CERRADA' and p.saldo_cant > 1
      order by p.obra_id desc, p.id limit 1`,
  )[0];

test.describe("@logistica borrador de Nueva OC / OS", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("al salir y volver a Nueva OS sigue todo como estaba; cada tipo tiene el suyo", async ({ abrir }) => {
    const [obra, descripcion] = partida();
    const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
    await page.getByPlaceholder("Buscar partida").fill(descripcion.slice(0, 20));
    await page.locator("main label").filter({ hasText: descripcion.slice(0, 20) }).first().locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: /^Continuar/ }).click();

    await page.getByRole("button", { name: "Proveedor", exact: true }).click();
    const opcion = page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").first();
    const proveedor = (await opcion.locator("span span").first().innerText()).trim();
    await opcion.click();
    await page.getByRole("button", { name: "Comprobante", exact: true }).click();
    await page.getByRole("listbox", { name: "Comprobante" }).getByRole("option", { name: "Factura" }).click();
    await page.getByLabel("Fecha de inicio").fill("2026-01-15");

    // Sale de la pantalla y entra de nuevo, sin la obra en la URL (el botón Nueva).
    await page.goto("/logistica?tipo=OS");
    await page.goto("/logistica/ordenes/nueva?tipo=OS");
    await expect(page).toHaveURL(new RegExp(`obra=${obra}`));
    await expect(page.getByRole("button", { name: "Proveedor", exact: true })).toContainText(proveedor);
    await expect(page.getByRole("button", { name: "Comprobante", exact: true })).toContainText("Factura");
    await expect(page.getByLabel("Fecha de inicio")).toHaveValue("2026-01-15");
    await expect(page.locator("main")).toContainText(descripcion.slice(0, 20));

    // También si cierra la app: una recarga sigue igual.
    await page.reload();
    await expect(page.getByRole("button", { name: "Proveedor", exact: true })).toContainText(proveedor);

    // Nueva OC es otro borrador.
    await page.goto("/logistica/ordenes/nueva?tipo=OC");
    await expect(page.getByRole("button", { name: "Obra", exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/obra=/);

    // Si la partida ya no tiene saldo, no se retoma: vuelve a empezar.
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("prod1_borrador") && x.endsWith("_OS"))!;
      const b = JSON.parse(localStorage.getItem(k)!);
      b.sel = [[-1, "1"]];
      localStorage.setItem(k, JSON.stringify(b));
    });
    await page.goto(`/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
    await expect(page.getByPlaceholder("Buscar partida")).toBeVisible();
    await expect(page.getByRole("button", { name: "Proveedor", exact: true })).toHaveCount(0);
  });

  test("en Samsung Internet la hoja se cierra y elige con toques, y lo que pasa llega a los logs", async ({ browser }, info) => {
    const [obra, descripcion] = partida();
    const ctx = await browser.newContext({ ...info.project.use, userAgent: SAMSUNG, storageState: sesion("logistica"), hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const avisos: string[] = [];
    // Del contexto: el envío al salir de la pantalla sale de un documento que ya se fue.
    ctx.on("request", (r) => {
      if (r.url().endsWith("/diagnostico")) avisos.push(r.postData() ?? "");
    });
    await page.goto(`/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
    await page.getByPlaceholder("Buscar partida").fill(descripcion.slice(0, 20));
    await page.locator("main label").filter({ hasText: descripcion.slice(0, 20) }).first().locator('input[type="checkbox"]').tap();
    await page.getByRole("button", { name: /^Continuar/ }).tap();
    await page.getByRole("button", { name: "Proveedor", exact: true }).tap();
    const hoja = page.getByRole("dialog", { name: "Proveedor" });
    await expect(hoja).toBeVisible();
    // La causa del S25: la hoja estaba dentro del <label> de Field, y Samsung Internet reenviaba cada toque al botón, que la
    // reabría. Ninguna hoja puede quedar dentro de un label.
    expect(await page.evaluate(() => [...document.querySelectorAll("dialog")].filter((d) => d.closest("label")).length), "hojas dentro de un label").toBe(0);
    expect(await page.evaluate(() => document.activeElement?.tagName), "el buscador toma el foco").toBe("INPUT");
    await hoja.getByRole("button", { name: "Cerrar" }).tap();
    await expect(hoja).toHaveCount(0);

    await page.getByRole("button", { name: "Comprobante", exact: true }).tap();
    expect(await page.evaluate(() => [...document.querySelectorAll("dialog")].filter((d) => d.closest("label")).length), "tampoco esta").toBe(0);
    await page.getByRole("listbox", { name: "Comprobante" }).getByRole("option", { name: "Factura" }).tap();

    await page.getByRole("button", { name: "Proveedor", exact: true }).tap();
    await page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").first().tap();
    await expect(hoja).toHaveCount(0);

    // Lo que pasó con los toques llega a los logs.
    await expect.poll(() => avisos.join(" "), { timeout: 6000 }).toContain("«Cerrar»");
    expect(avisos.join(" ")).toContain("abre «Proveedor»");
    expect(avisos.join(" ")).toContain("hojas=1");
    expect(avisos.join(" "), "se cerró: nada que avisar").not.toContain("sigue-abierta");

    // Una hoja trabada, como la del S25: los toques llegan pero no la cierran. Queda en los logs, aunque salga enseguida.
    avisos.length = 0;
    await page.evaluate(() => {
      document.addEventListener("click", (e) => (e.target as Element).closest?.("dialog") && e.stopPropagation(), { capture: true });
    });
    await page.getByRole("button", { name: "Proveedor", exact: true }).tap();
    await expect(hoja).toBeVisible();
    await hoja.getByPlaceholder("Buscar").tap();
    await hoja.getByPlaceholder("Buscar").fill("TEXTO-PRIVADO");
    await hoja.getByRole("button", { name: "Cerrar" }).tap();
    await expect.poll(() => avisos.join(" "), { timeout: 6000 }).toContain("sigue-abierta «Proveedor» tras click en «Cerrar»");
    expect(avisos.join(" "), "lo escrito no viaja").not.toContain("TEXTO-PRIVADO");

    // Si los toques ni llegan: queda «abre» y nada más. Y lo pendiente sale al abandonar la pantalla.
    await page.reload();
    await page.getByRole("button", { name: "Proveedor", exact: true }).tap();
    await expect(hoja).toBeVisible();
    // (Un envío de una página que ya se fue no se ve desde aquí: se dispara el mismo evento con la página viva.)
    avisos.length = 0;
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => avisos.join(" "), { timeout: 1500 }).toContain("abre «Proveedor»");
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("prod1_borrador")).forEach((k) => localStorage.removeItem(k)));
    await ctx.close();
  });
});
