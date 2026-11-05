import { expect, test } from "./fixtures";
import { sesion, sql } from "./lib";

// Archivos guardados (factura, voucher): el enlace firmado vence a la hora. Si la imagen no carga, no queda rota: pide
// enlaces nuevos y, si aun así falla, dice «No se pudo cargar» con «Reintentar».

test.describe("@archivos imagen de un archivo guardado", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  // Sin `abrir`: el error de carga es a propósito (abrir lo cuenta como falla de la pantalla).
  test("si el archivo no carga, dice «No se pudo cargar» y al reintentar se ve", async ({ browser }, info) => {
    // Una orden en Tesorería con la imagen de su factura.
    const fila = sql(`select l.obra_id, l.numero_oc, c.serie || '-' || c.numero from oc_items l join comprobantes c on c.id = l.comprobante_id
                       join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
                      where o.estado = 'EN_TESORERIA' and c.archivo_path ~* '\\.(png|jpe?g|webp)$'
                        and exists (select 1 from storage.objects s where s.bucket_id = 'comprobantes' and s.name = c.archivo_path)
                      order by 1, 2 limit 1`)[0];
    test.skip(!fila, "sin facturas con imagen");
    const [obra, numero, factura] = fila;
    const ctx = await browser.newContext({ ...info.project.use, storageState: sesion("tesoreria") });
    const page = await ctx.newPage();
    // El archivo no responde (como un enlace vencido).
    const bloquear = /\/storage\/v1\/object\/sign\/comprobantes\//;
    await page.route(bloquear, (r) => r.fulfill({ status: 400, body: "expirado" }));
    await page.goto(`/tesoreria/pago/${obra}/${encodeURIComponent(numero)}`);
    // La imagen se carga al quedar a la vista.
    await page.getByText(`Factura ${factura}`, { exact: true }).first().scrollIntoViewIfNeeded();
    const aviso = page.getByRole("alert").filter({ hasText: `No se pudo cargar Factura ${factura}` });
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: `Factura ${factura}` })).toHaveCount(0);

    // Vuelve a responder: «Reintentar» trae la pantalla con enlaces nuevos y la imagen se ve.
    await page.unroute(bloquear);
    await aviso.getByRole("button", { name: "Reintentar" }).click();
    const imagen = page.getByRole("img", { name: `Factura ${factura}` });
    await expect(imagen).toBeVisible({ timeout: 20_000 });
    await imagen.scrollIntoViewIfNeeded();
    await expect.poll(() => imagen.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await ctx.close();
  });
});
