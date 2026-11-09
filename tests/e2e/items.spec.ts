import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Prod 1: los ítems los crea Gerencia (con la cuenta contable, opcional); Logística solo los consulta y
// clasifica. Los ítems de prueba se borran al final.

test.describe("@prod1 ítems", () => {
  test("Logística ve el catálogo y clasifica, pero no crea ítems", async ({ abrir }) => {
    const page = await abrir("logistica", "/logistica/items");
    await expect(page.locator("main li").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Nuevo (material|servicio)$/ })).toHaveCount(0);
    // Tocar un ítem abre su clasificación (tipo de material).
    await page.locator("main li button").first().click();
    await expect(page.getByRole("listbox")).toBeVisible();
  });

  test("la base no deja a Logística crear ítems; a Gerencia sí", async () => {
    const como = (rol: string, q: string) => {
      const uid = sql1(`select user_id from perfiles where rol = '${rol}' limit 1`);
      return sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                        set local role authenticated; ${q}; rollback;`);
    };
    const insertar = "insert into items (descripcion, unidad, rubro) values ('E2E ITEM PERMISO', 'UND', 'MATERIAL') returning 'creado'";
    expect(() => como("LOGISTICA", insertar)).toThrow(/row-level security/);
    expect(como("GERENCIA", insertar).flat()).toContain("creado");
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
    await expect(parecidos.locator("p").first()).toHaveText("Ya existe");
    await expect(hoja.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  test("el mismo ítem escrito de otra forma no se crea; uno casi igual, confirmando que es otro", async ({ abrir }) => {
    // Primera palabra de 6 letras o más que no termina en S (para escribirla en plural o con una letra de menos).
    const [desc] = sql(`select descripcion from items where rubro = 'MATERIAL' and descripcion ~ '^[A-Z]{5,}[A-RT-Z] [A-Z]{3,} [A-Z]{3,}$'
                        order by id limit 1`)[0];
    const [primera, ...resto] = desc.split(" ");
    const page = await abrir("gerencia", "/gerencia/items");
    await page.getByRole("button", { name: "Nuevo material" }).click();
    const hoja = page.getByRole("dialog", { name: "Nuevo material" });
    await hoja.getByRole("button", { name: "Unidad", exact: true }).click();
    await page.getByRole("listbox", { name: "Unidad" }).getByRole("option").first().click();
    const parecidos = hoja.getByRole("region", { name: "Ítems parecidos" });
    const guardar = hoja.getByRole("button", { name: "Guardar" });
    // En plural, con un conector y otro orden: es el mismo.
    await hoja.getByLabel("Descripción").fill(`${resto.join(" ")} de ${primera}s`.toLowerCase());
    await expect(parecidos.locator("p").first()).toHaveText("Ya existe");
    await expect(parecidos.locator("li").first()).toContainText(desc);
    await expect(guardar).toBeDisabled();
    // Con una letra de menos: casi igual; se guarda solo confirmando que es otro.
    const errata = primera.slice(0, 2) + primera.slice(3);
    await hoja.getByLabel("Descripción").fill([errata, ...resto].join(" "));
    await expect(parecidos).toContainText("Ya existe uno casi igual");
    await expect(guardar).toBeDisabled();
    await expect(hoja.getByText("Falta: confirmar que es otro ítem")).toBeVisible();
    await hoja.getByLabel("Es otro ítem").check();
    await expect(guardar).toBeEnabled();
    // Al cambiar la descripción, se vuelve a confirmar.
    await hoja.getByLabel("Descripción").fill([errata, ...resto].join(" ") + " ");
    await expect(hoja.getByLabel("Es otro ítem")).not.toBeChecked();
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
