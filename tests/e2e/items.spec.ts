import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Prod 1: los ítems los crean Gerencia y Logística (con la cuenta contable, opcional); la tolerancia de sobreprecio la
// pone solo Gerencia. Logística además los clasifica. Los ítems de prueba se borran al final.

test.describe("@prod1 ítems", () => {
  test("Logística ve el catálogo, clasifica y crea ítems (sin tolerancia)", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica/items");
    await expect(page.locator("main li").first()).toBeVisible();
    await page.getByRole("button", { name: "Nuevo material" }).click();
    const hoja = page.getByRole("dialog", { name: "Nuevo material" });
    await expect(hoja.getByLabel("Descripción")).toBeVisible();
    await expect(hoja.getByText("Tolerancia %")).toHaveCount(0);
    await expect(hoja.getByRole("button", { name: "Cuenta contable", exact: true })).toBeVisible();
    await hoja.getByRole("button", { name: "Cerrar" }).click();
    // Tocar un ítem abre su clasificación (tipo de material).
    await page.locator("main li button").first().click();
    await expect(page.getByRole("listbox")).toBeVisible();
  });

  test("la base deja a Logística crear ítems solo con tolerancia 0; a Gerencia con cualquiera", async () => {
    const como = (rol: string, q: string) => {
      const uid = sql1(`select user_id from perfiles where rol = '${rol}' limit 1`);
      return sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                        set local role authenticated; ${q}; rollback;`);
    };
    const insertar = (tol: number) =>
      `insert into items (descripcion, unidad, rubro, tolerancia_pct) values ('E2E ITEM PERMISO', 'UND', 'MATERIAL', ${tol}) returning 'creado'`;
    expect(como("LOGISTICA", insertar(0)).flat()).toContain("creado");
    expect(() => como("LOGISTICA", insertar(0.05))).toThrow(/row-level security/);
    expect(como("GERENCIA", insertar(0.05)).flat()).toContain("creado");
    // Logística lee el plan de cuentas (para elegir la cuenta del ítem).
    expect(Number(como("LOGISTICA", "select count(*) from cuentas_contables").flat().at(-1))).toBeGreaterThan(0);
  });

  test("al escribir la descripción muestra los ítems parecidos; con uno igual no deja guardar", async ({ abrir }) => {
    // Un material del catálogo de 2 o más palabras: se escribe en minúsculas y con una palabra de menos.
    const [desc, unidad] = sql(`select descripcion, unidad from items where rubro = 'MATERIAL' and descripcion ~ '^[A-Z]{4,} [A-Z]{3,} [A-Z0-9]'
                                order by id limit 1`)[0];
    const page = await abrir("gerencia", "/gerencia/items");
    await page.getByRole("button", { name: "Nuevo material" }).click();
    const hoja = page.getByRole("dialog", { name: "Nuevo material" });
    await hoja.getByRole("button", { name: "Unidad", exact: true }).click();
    await page.getByRole("listbox", { name: "Unidad" }).getByRole("option").first().click();
    const parecidos = hoja.getByRole("region", { name: "Ítems parecidos" });
    await expect(parecidos).toHaveCount(0);
    await hoja.getByLabel("Descripción").fill(desc.split(" ").slice(0, 2).join(" ").toLowerCase());
    await expect(parecidos).toContainText("Ya existen parecidos");
    await expect(parecidos.locator("li").filter({ hasText: desc })).toContainText(unidad);
    await expect(hoja.getByRole("button", { name: "Guardar" })).toBeEnabled();
    // El mismo nombre (sin importar mayúsculas): no se guarda.
    await hoja.getByLabel("Descripción").fill(desc.toLowerCase());
    await expect(parecidos).toContainText("Ya existe con ese nombre");
    await expect(hoja.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  test("Logística crea un servicio con su cuenta contable: nace con tolerancia 0", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const descripcion = `E2E SERVICIO LOGISTICA ${Date.now() % 1000000}`;
    const [codigo] = sql("select codigo from cuentas_contables where tipo = 'GASTO' order by codigo limit 1")[0];
    try {
      const page = await abrir("logistica", "/logistica/items?clase=serv");
      await page.getByRole("button", { name: "Nuevo servicio" }).click();
      const hoja = page.getByRole("dialog", { name: "Nuevo servicio" });
      await hoja.getByLabel("Descripción").fill(descripcion);
      await hoja.getByRole("button", { name: "Unidad", exact: true }).click();
      await page.getByRole("listbox", { name: "Unidad" }).getByRole("option").first().click();
      await hoja.getByRole("button", { name: "Cuenta contable", exact: true }).click();
      await page.getByLabel("Buscar Cuenta contable").fill(codigo);
      await page.getByRole("listbox", { name: "Cuenta contable" }).getByRole("option").filter({ hasText: new RegExp(`^${codigo} `) }).click();
      await hoja.getByRole("button", { name: "Guardar" }).click();
      await expect(hoja).toBeHidden();
      expect(sql(`select cuenta_contable, tolerancia_pct::float, rubro from items where descripcion = '${descripcion}'`)).toEqual([[codigo, "0", "MANO OBRA"]]);
    } finally {
      sql(`delete from items where descripcion = '${descripcion}'`);
    }
  });

  test("Gerencia crea un material con su cuenta contable y otro sin ella", async ({ abrir, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const sufijo = Date.now() % 1000000;
    const conCuenta = `E2E MATERIAL CON CUENTA ${sufijo}`;
    const sinCuenta = `E2E MATERIAL SIN CUENTA ${sufijo}`;
    const [codigo] = sql("select codigo from cuentas_contables where tipo = 'GASTO' order by codigo limit 1")[0];
    try {
      const page = await abrir("gerencia", "/gerencia/items");
      await expect(page.getByRole("link", { name: "Ítems", exact: true })).toHaveAttribute("aria-current", "page");
      await revisarPantalla(page);
      for (const [descripcion, cuenta] of [[conCuenta, codigo], [sinCuenta, null]] as const) {
        await page.getByRole("button", { name: "Nuevo material" }).click();
        const hoja = page.getByRole("dialog", { name: "Nuevo material" });
        await hoja.getByLabel("Descripción").fill(descripcion);
        await hoja.getByRole("button", { name: "Unidad", exact: true }).click();
        await page.getByRole("listbox", { name: "Unidad" }).getByRole("option").first().click();
        if (cuenta) {
          await hoja.getByRole("button", { name: "Cuenta contable", exact: true }).click();
          await page.getByLabel("Buscar Cuenta contable").fill(cuenta);
          await page.getByRole("listbox", { name: "Cuenta contable" }).getByRole("option").filter({ hasText: new RegExp(`^${cuenta} `) }).click();
        }
        await hoja.getByRole("button", { name: "Guardar" }).click();
        await expect(hoja).toBeHidden();
      }
      expect(sql(`select descripcion, coalesce(cuenta_contable, '-'), rubro from items where descripcion in ('${conCuenta}', '${sinCuenta}') order by 1`)).toEqual([
        [conCuenta, codigo, "MATERIAL"],
        [sinCuenta, "-", "MATERIAL"],
      ]);
    } finally {
      sql(`delete from items where descripcion in ('${conCuenta}', '${sinCuenta}')`);
    }
  });
});
