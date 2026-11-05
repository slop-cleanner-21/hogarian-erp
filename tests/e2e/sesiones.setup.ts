import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import { EN_PROD, ROLES, sesion, type Rol } from "./lib";

// Inicia sesión una vez por rol (en paralelo) y guarda las cookies; las pruebas las reutilizan.
// Se reutiliza la sesión guardada si tiene menos de 40 minutos.
const DEMO = process.env.ERP_DEMO;
const PASS = process.env.ERP_PASS;

// En producción solo existen las cuentas temporales del recorrido, y no hay pantalla de acceso.
const ROLES_PROD: Rol[] = ["gerencia", "logistica", "tesoreria", "jefe", "admin"];

for (const rol of EN_PROD ? ROLES_PROD : (Object.keys(ROLES) as Rol[])) {
  setup(`sesión ${rol}`, async ({ page }) => {
    setup.skip(fs.existsSync(sesion(rol)) && Date.now() - fs.statSync(sesion(rol)).mtimeMs < 40 * 60_000, "sesión vigente");
    expect((EN_PROD || DEMO) && PASS, "Define ERP_DEMO y ERP_PASS").toBeTruthy();
    if (!EN_PROD) {
      await page.goto("/acceso");
      if (page.url().includes("/acceso")) {
        await page.locator('input[name="clave"]').fill(DEMO!);
        await page.getByRole("button", { name: "Entrar" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/acceso"));
      }
    }
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(ROLES[rol]);
    await page.locator('input[name="password"]').fill(PASS!);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.context().storageState({ path: sesion(rol) });
  });
}
