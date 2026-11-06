import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql1, type Rol } from "./lib";

// Vaciar un buscador: lo borrado no puede volver. Tenía dos causas:
//   · al pedir la lista sin filtros, el servidor la redirigía a la vista guardada, que aún tenía lo buscado;
//   · en una lista lenta, la URL de un texto anterior llegaba tarde y pisaba lo que el usuario ya había borrado.
// Se prueba en todas las pantallas con buscador y con la red frenada, como un celular con mala señal.

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const obra = () => sql1(`select id from obras where presupuesto_estado = 'PUBLICADO' and estado <> 'CERRADA' order by id limit 1`);

const PANTALLAS: [Rol, string, () => string][] = [
  ["logistica", "OC", () => "/logistica?tipo=OC&tab=todas"],
  ["logistica", "OS", () => "/logistica?tipo=OS&tab=todas"],
  ["logistica", "proveedores", () => "/logistica/proveedores"],
  ["logistica", "ítems", () => "/logistica/items"],
  ["logistica", "transportistas", () => "/logistica/transportistas"],
  ["tesoreria", "pagos", () => "/tesoreria?empresa=todas&area=log"],
  ["tesoreria", "presupuesto", () => `/tesoreria/consultas?obra=${obra()}`],
  ["gerencia", "órdenes", () => "/gerencia/ordenes"],
  ["gerencia", "ítems", () => "/gerencia/items"],
  ["gerencia", "seguimiento", () => `/gerencia/presupuesto?obra=${obra()}`],
  ["jefe", "seguimiento", () => `/operaciones?obra=${obra()}`],
  ["admin", "auditoría", () => "/admin/auditoria"],
];

/** Toda respuesta de navegación interna tarda: la URL llega después de que el usuario siguió escribiendo. */
const frenarRed = (page: Page) =>
  page.route(
    (u) => u.searchParams.has("_rsc"),
    async (r) => {
      await esperar(700);
      await r.continue().catch(() => {});
    },
  );

test.describe("@listas vaciar el buscador", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  for (const [rol, nombre, ruta] of PANTALLAS) {
    test(`${rol} › ${nombre}: lo borrado no vuelve`, async ({ abrir }) => {
      test.setTimeout(60_000);
      const page = await abrir(rol, ruta());
      await frenarRed(page);
      const buscador = page.locator('input[type="search"]').first();
      await expect(buscador).toBeVisible();

      // Escribe, espera a que la lista filtre y borra letra por letra, más rápido de lo que responde la red.
      await buscador.fill("john");
      await expect(page).toHaveURL(/q=john/, { timeout: 5000 });
      await buscador.focus();
      await page.keyboard.press("End");
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Backspace");
        await esperar(320);
        await expect(buscador, `tras borrar ${i + 1}`).toHaveValue("john".slice(0, 3 - i));
      }
      await esperar(2500);
      await expect(buscador, "sigue vacío").toHaveValue("");
      await expect(page).not.toHaveURL(/[?&]q=[^&]/);

      // De una vez.
      await buscador.fill("john");
      await expect(page).toHaveURL(/q=john/, { timeout: 5000 });
      await buscador.fill("");
      await esperar(2000);
      await expect(buscador, "de una vez").toHaveValue("");
      await expect(page).not.toHaveURL(/[?&]q=[^&]/);

      // Borrar a medias deja lo que quedó.
      await buscador.fill("john");
      await expect(page).toHaveURL(/q=john/, { timeout: 5000 });
      await buscador.fill("jo");
      await esperar(1800);
      await expect(buscador, "a medias").toHaveValue("jo");
      await expect(page).toHaveURL(/q=jo(&|$)/);
      await buscador.fill("");
      await esperar(1500);
    });
  }

  test("al volver desde otra pantalla restaura lo último; si se vació, queda vacía", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica/proveedores");
    const buscador = page.getByLabel("Razón social o RUC");
    await buscador.fill("john");
    await expect(page).toHaveURL(/q=john/);
    await esperar(400);
    await page.goto("/logistica/items");
    await page.goto("/logistica/proveedores");
    await expect(page).toHaveURL(/q=john/);
    await expect(buscador).toHaveValue("john");

    await buscador.fill("");
    await expect(page).not.toHaveURL(/q=j/);
    await esperar(800);
    await page.goto("/logistica/items");
    await page.goto("/logistica/proveedores");
    await esperar(800);
    await expect(buscador).toHaveValue("");
  });

  test("el buscador sigue a la URL cuando cambia desde fuera (limpiar filtros)", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica/proveedores?q=john");
    const buscador = page.getByLabel("Razón social o RUC");
    await expect(buscador).toHaveValue("john");
    await page.goBack().catch(() => {});
    await page.goto("/logistica/proveedores?q=maria");
    await expect(buscador).toHaveValue("maria");
    await buscador.fill("");
    await esperar(800);
  });
});
