import { expect, test } from "./fixtures";
import { sql1, sqlScript } from "./lib";

// Operaciones (Jefe e Ingeniero) no ve nada de dinero ni contable: ni en su seguimiento ni por la API.

test.describe("@operaciones sin dinero", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("su seguimiento trae las cantidades, sin P.U. ni retención; las tablas con dinero no le devuelven nada", () => {
    const como = (patron: string) => `select set_config('request.jwt.claims', json_build_object('sub',
      (select id from auth.users where email like '${patron}' limit 1), 'role', 'authenticated')::text, true);`;
    const filas = sqlScript(`begin;
      ${como("jefeoperaciones%")}
      set local role authenticated;
      select 'jefe', count(*), count(pu), coalesce(sum(retencion_acumulada), 0), round(sum(presupuesto_efectivo)) from v_seguimiento_partida;
      select 'jefe_tablas', (select count(*) from partidas), (select count(*) from oc_items), (select count(*) from ordenes_compra),
        (select count(*) from items), (select count(*) from proveedores), (select count(*) from parametros);
      reset role;
      ${como("gerencia@%")}
      set local role authenticated;
      select 'gerencia', count(*), count(pu), 0, round(sum(presupuesto_efectivo)) from v_seguimiento_partida;
      reset role;
      rollback;`);
    const r = Object.fromEntries(filas.map(([k, ...v]) => [k, v]));
    expect(Number(r.jefe[0])).toBeGreaterThan(0);
    expect(r.jefe[1], "sin P.U.").toBe("0");
    expect(r.jefe[2], "sin retención").toBe("0");
    expect(r.jefe[0], "las mismas partidas que Gerencia").toBe(r.gerencia[0]);
    expect(r.jefe[3], "las mismas cantidades").toBe(r.gerencia[3]);
    expect(Number(r.gerencia[1]), "Gerencia sí ve el P.U.").toBeGreaterThan(0);
    expect(r.jefe_tablas, "partidas, órdenes, ítems, proveedores y parámetros").toEqual(["0", "0", "0", "0", "0", "0"]);
  });

  test("en pantalla: ni un monto", async ({ abrir }) => {
    const obra = sql1(`select o.id from obras o where o.presupuesto_estado = 'PUBLICADO'
      and exists (select 1 from partidas p join items i on i.id = p.item_id where p.obra_id = o.id and i.rubro <> 'MATERIAL') order by o.id limit 1`);
    for (const grupo of ["MATERIALES", "MANO_OBRA", "SUBCONTRATOS"]) {
      const page = await abrir("jefe", `/operaciones?obra=${obra}&grupo=${grupo}`);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main"), grupo).not.toContainText("S/");
      await expect(page.locator("main"), grupo).not.toContainText("P.U.");
    }
  });
});
