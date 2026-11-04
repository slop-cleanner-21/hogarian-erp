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
});
