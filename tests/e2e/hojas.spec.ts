import { expect, test } from "./fixtures";

// Hojas (Sheet): el botón del pie no queda pegado al borde inferior. Antes, «pb-safe» reemplazaba el relleno
// del pie y, sin margen de iPhone (Android, computadora), quedaba en 0.

test.describe("@ui hojas", () => {
  for (const [ancho, alto] of [[0, 0], [1280, 800]] as const) {
    test(`el botón del pie tiene aire abajo${ancho ? ` (${ancho} px)` : ""}`, async ({ abrir }) => {
      const page = await abrir("gerencia", "/gerencia/items");
      if (ancho) await page.setViewportSize({ width: ancho, height: alto });
      await page.getByRole("button", { name: "Nuevo material" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo material" });
      const boton = hoja.getByRole("button", { name: "Guardar" });
      const pie = hoja.locator("footer");
      await expect(boton).toBeVisible();
      const [b, f] = [(await boton.boundingBox())!, (await pie.boundingBox())!];
      expect(f.y + f.height - (b.y + b.height), "espacio entre el botón y el borde inferior (px)").toBeGreaterThanOrEqual(8);
    });
  }

  test("apretar dentro y soltar fuera no la cierra; tocar fuera sí", async ({ abrir }) => {
    const page = await abrir("gerencia", "/gerencia/items");
    await page.getByRole("button", { name: "Nuevo material" }).click();
    const hoja = page.getByRole("dialog", { name: "Nuevo material" });
    await expect(hoja).toBeVisible();
    const campo = (await hoja.getByRole("textbox").first().boundingBox())!;
    // Apretar en el campo (p. ej. para seleccionar el texto) y soltar arriba, en el fondo.
    await page.mouse.move(campo.x + 10, campo.y + campo.height / 2);
    await page.mouse.down();
    await page.mouse.move(20, 20, { steps: 5 });
    await page.mouse.up();
    await expect(hoja).toBeVisible();
    // Un toque entero en el fondo la cierra.
    await page.mouse.click(20, 20);
    await expect(hoja).toBeHidden();
  });

  test("lo mismo en la confirmación", async ({ abrir }) => {
    const page = await abrir("gerencia", "/gerencia/obras?tab=pub");
    await page.locator("main a[href^='/gerencia/obras/']").first().click();
    await page.getByRole("button", { name: "Cerrar obra" }).click();
    const confirmar = page.getByRole("dialog", { name: "¿Cerrar la obra?" });
    await expect(confirmar).toBeVisible();
    const titulo = (await confirmar.getByRole("heading").boundingBox())!;
    await page.mouse.move(titulo.x + 10, titulo.y + 10);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 });
    await page.mouse.up();
    await expect(confirmar).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(confirmar).toBeHidden();
  });
});
