import { expect, test } from "./fixtures";
import { ROLES, sql, sql1 } from "./lib";

// Admin › Empresas: razón social, RUC, dirección fiscal y quién firma los contratos de cada empresa. Lo que se
// guarda queda en la auditoría a nombre del Admin. Se restaura al final.

test.describe("@admin empresas", () => {
  test("el Admin completa una empresa (RUC validado, firmante de Gerencia) y queda en la auditoría", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [id, nombre, antes] = sql(`select id, nombre, row_to_json(e)::text from empresas e where nombre = 'ARISANT'`)[0];
    const [gerenteId, gerente] = sql(`select user_id, nombre from perfiles where rol = 'GERENCIA' order by user_id limit 1`)[0];
    const admin = sql1(`select id from auth.users where email = '${ROLES.admin}'`);
    const desde = sql1("select coalesce(max(id), 0) from audit_log");
    try {
      const page = await abrir("admin", "/admin/empresas");
      const tarjeta = page.locator("main li button").filter({ hasText: nombre });
      await expect(tarjeta).toContainText("Sin RUC");
      await tarjeta.click();
      const hoja = page.getByRole("dialog", { name: nombre });
      await hoja.getByLabel("Razón social").fill("Arisant Constructora S.A.C.");
      await hoja.getByLabel("RUC").fill("3060000000");
      await expect(hoja.getByRole("button", { name: "Guardar" }), "RUC inválido").toBeDisabled();
      await hoja.getByLabel("RUC").fill("20612345678");
      await hoja.getByLabel("Dirección fiscal").fill("Av. Larco 123, Trujillo");
      await hoja.getByRole("button", { name: "Firma los contratos", exact: true }).click();
      await page.getByRole("listbox", { name: "Firma los contratos" }).getByRole("option").filter({ hasText: gerente }).first().click();
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      await expect(tarjeta).toContainText("RUC 20612345678");
      await expect(tarjeta).toContainText(`Firma: ${gerente}`);
      expect(sql(`select razon_social, ruc, direccion, firmante_id from empresas where id = ${id}`)).toEqual([
        ["ARISANT CONSTRUCTORA S.A.C.", "20612345678", "Av. Larco 123, Trujillo", gerenteId],
      ]);
      expect(sql(`select accion, user_id from audit_log where id > ${desde} and tabla = 'empresas' and registro = '${id}'`)).toEqual([["UPDATE", admin]]);
    } finally {
      const e = JSON.parse(antes);
      sql(`update empresas set razon_social = ${e.razon_social ? `'${e.razon_social}'` : "null"}, ruc = ${e.ruc ? `'${e.ruc}'` : "null"},
             direccion = ${e.direccion ? `'${e.direccion}'` : "null"}, firmante_id = ${e.firmante_id ? `'${e.firmante_id}'` : "null"} where id = ${id}`);
    }
  });

  test("solo el Admin entra a Empresas", async ({ abrir }) => {
    const page = await abrir("gerencia", "/admin/empresas");
    expect(new URL(page.url()).pathname).not.toBe("/admin/empresas");
  });
});
