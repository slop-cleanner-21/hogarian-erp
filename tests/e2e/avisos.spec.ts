import { expect, test } from "./fixtures";
import { sql, sql1 } from "./lib";

// Avisos agrupados por día (en Lima), cada día con su fecha completa con año; «Hoy» y «Ayer» con su nombre.

test.describe("@prod1 avisos", () => {
  test("agrupados por día, del más reciente al más antiguo, con el año", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const uid = sql1("select id from auth.users where email = 'logistica@erp.local'");
    const marca = `E2E aviso ${Date.now()}`;
    try {
      sql(`insert into notificaciones (user_id, tipo, titulo, cuerpo, created_at) values
             ('${uid}', 'E2E', '${marca} hoy', null, now()),
             ('${uid}', 'E2E', '${marca} ayer', null, now() - interval '1 day'),
             ('${uid}', 'E2E', '${marca} viejo', null, '2025-03-10 15:30:00-05')`);
      const page = await abrir("logistica", "/avisos");
      const dia = (titulo: string) => page.locator("main section").filter({ has: page.getByText(titulo, { exact: true }) });
      await expect(dia(`${marca} hoy`).getByRole("heading")).toHaveText(/^Hoy, \p{L}+, \d{1,2} de \p{L}+ de \d{4}$/u);
      await expect(dia(`${marca} ayer`).getByRole("heading")).toHaveText(/^Ayer, \p{L}+, \d{1,2} de \p{L}+ de \d{4}$/u);
      await expect(dia(`${marca} viejo`).getByRole("heading")).toHaveText("Lunes, 10 de marzo de 2025");
      await expect(dia(`${marca} viejo`).locator("li").filter({ hasText: `${marca} viejo` })).toContainText("15:30");
      // Los días, del más reciente al más antiguo.
      const titulos = await page.locator("main section h2").allInnerTexts();
      expect(titulos.findIndex((t) => t.startsWith("Hoy"))).toBeLessThan(titulos.findIndex((t) => t.startsWith("Ayer")));
      expect(titulos.findIndex((t) => t.startsWith("Ayer"))).toBeLessThan(titulos.indexOf("Lunes, 10 de marzo de 2025"));
    } finally {
      sql(`delete from notificaciones where titulo like '${marca}%'`);
    }
  });
});
