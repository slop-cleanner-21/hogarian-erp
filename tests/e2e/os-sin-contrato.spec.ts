import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Prod 1: servicios que no llevan contrato (un alquiler por horas, por ejemplo). Logística los marca en su
// catálogo o al crear la OS; una OS cuyos servicios son todos «sin contrato» va a Tesorería sin el firmado y el
// link del proveedor no le muestra un contrato para firmar. Lo que se escribe se revierte al final.

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("@prod1 @logistica OS sin contrato", () => {
  test("la base: sin contrato firmado no se envía, salvo que todos sus servicios estén marcados «sin contrato»", async () => {
    const fila = sql(
      `select o.obra_id, o.numero, o.token_cotizacion from ordenes_compra o
        where o.tipo = 'OS' and o.estado = 'FACTURADA' and not o.historico and o.valorizacion_id is null
        order by o.obra_id, o.numero limit 1`,
    )[0];
    test.skip(!fila, "no hay OS facturadas");
    const [obra, numero, token] = fila;
    const uid = uidDe("LOGISTICA");
    const enviar = (clave: string) => `
      select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
      set local role authenticated;
      do $$ begin
        perform enviar_a_tesoreria(${obra}, '${numero}');
        perform set_config('t.${clave}', 'ok', true);
      exception when others then
        perform set_config('t.${clave}', 'error: ' || sqlerrm, true);
      end $$;
      reset role;`;
    const [res] = sqlScript(`begin;
      delete from adjuntos where tipo = 'CONTRATO' and obra_id = ${obra} and numero_oc = '${numero}';
      -- El link abierto (como el del proveedor tras recibir la orden).
      update ordenes_compra set cotizacion_estado = 'RECIBIDA' where obra_id = ${obra} and numero = '${numero}' and cotizacion_estado = 'SIN_ENVIAR';
      select (get_cotizacion('${token}'::uuid)->>'contrato') is not null as contrato_antes \\gset
      ${enviar("con")}
      update items set sin_contrato = true
       where id in (select p.item_id from oc_items l join partidas p on p.id = l.partida_id where l.obra_id = ${obra} and l.numero_oc = '${numero}');
      ${enviar("sin")}
      select current_setting('t.con'), current_setting('t.sin'), :'contrato_antes', (get_cotizacion('${token}'::uuid)->>'contrato') is not null;
      rollback;`).filter((l) => l.length === 4);
    const [con, sin, contratoAntes, contratoDespues] = res;
    expect(con).toMatch(/Falta el contrato firmado/);
    expect(sin).not.toMatch(/contrato/);
    expect(contratoAntes, "el link ofrecía el contrato para firmar").toBe("t");
    expect(contratoDespues, "el link no ofrece un contrato para firmar").toBe("f");
  });

  test("la base: con un servicio que sí lleva contrato, lo sigue pidiendo; solo se marca un servicio", async () => {
    const fila = sql(
      `select o.obra_id, o.numero from ordenes_compra o
        where o.tipo = 'OS' and o.estado = 'FACTURADA' and not o.historico and o.valorizacion_id is null
          and (select count(distinct p.item_id) from oc_items l join partidas p on p.id = l.partida_id
                where l.obra_id = o.obra_id and l.numero_oc = o.numero) > 1
        order by o.obra_id, o.numero limit 1`,
    )[0];
    const uid = uidDe("LOGISTICA");
    if (fila) {
      const [obra, numero] = fila;
      const [res] = sqlScript(`begin;
        delete from adjuntos where tipo = 'CONTRATO' and obra_id = ${obra} and numero_oc = '${numero}';
        update items set sin_contrato = true
         where id = (select min(p.item_id) from oc_items l join partidas p on p.id = l.partida_id where l.obra_id = ${obra} and l.numero_oc = '${numero}');
        select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
        set local role authenticated;
        do $$ begin
          perform enviar_a_tesoreria(${obra}, '${numero}');
          perform set_config('t.r', 'ok', true);
        exception when others then
          perform set_config('t.r', 'error: ' || sqlerrm, true);
        end $$;
        select current_setting('t.r'), 'x';
        rollback;`).filter((l) => l.length === 2);
      expect(res[0]).toMatch(/Falta el contrato firmado/);
    }
    // Logística cambia la marca, pero no la de un material ni otra columna del ítem.
    const material = sql1(`select id from items where rubro = 'MATERIAL' order by id limit 1`);
    const como = (q: string) =>
      sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                 set local role authenticated; ${q}; rollback;`);
    expect(() => como(`update items set tolerancia_pct = 0.5 where id = ${material}`)).toThrow(/permission denied/);
    expect(() => como(`select os_lleva_contrato(1, '1')`)).toThrow(/permission denied/);
  });

  test("Ítems › Servicios: Logística marca un servicio «Sin contrato» y lo desmarca", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [id, descripcion] = sql(
      `select id, descripcion from items where rubro = 'SUBCONTRATO' and not sin_contrato order by id limit 1`,
    )[0];
    try {
      const page = await abrir("logistica", `/logistica/items?clase=serv&q=${encodeURIComponent(descripcion.slice(0, 30))}`);
      const casilla = page.getByRole("checkbox", { name: `${descripcion}: sin contrato` });
      await expect(casilla).not.toBeChecked();
      await casilla.check();
      await expect.poll(() => sql1(`select sin_contrato from items where id = ${id}`)).toBe("t");
      await page.reload();
      await expect(page.getByRole("checkbox", { name: `${descripcion}: sin contrato` })).toBeChecked();
      await page.getByRole("checkbox", { name: `${descripcion}: sin contrato` }).uncheck();
      await expect.poll(() => sql1(`select sin_contrato from items where id = ${id}`)).toBe("f");
    } finally {
      sql(`update items set sin_contrato = false where id = ${id}`);
    }
  });

  test("Nueva OS: «Sin contrato» por servicio, queda en el catálogo y la orden dice que no lleva", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [obra, descripcion, item] = sql(
      `select p.obra_id, p.descripcion, p.item_id from v_partidas p join obras o on o.id = p.obra_id join items i on i.id = p.item_id
        where p.rubro = 'SUBCONTRATO' and not i.sin_contrato and o.estado <> 'CERRADA' and o.presupuesto_estado = 'PUBLICADO' and p.saldo_cant > 1
        order by p.obra_id desc, p.id limit 1`,
    )[0];
    const [, proveedor] = sql(`select id, razon_social from proveedores where comprobante_habitual = 'RXH' order by id limit 1`)[0];
    const siguiente = sql1(`select siguiente_numero_oc(${obra})`);
    try {
      const page = await abrir("logistica", `/logistica/ordenes/nueva?tipo=OS&obra=${obra}`);
      await page.getByPlaceholder("Buscar partida").fill(descripcion.slice(0, 25));
      await page.locator("main label").filter({ hasText: descripcion }).first().locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: /^Continuar/ }).click();
      const main = page.locator("main");
      await main.getByRole("button", { name: "Proveedor", exact: true }).click();
      await page.getByLabel("Buscar Proveedor").fill(proveedor.slice(0, 20));
      await page.getByRole("listbox", { name: "Proveedor" }).getByRole("option").filter({ hasText: new RegExp(`^${escRe(proveedor)}`) }).first().click();
      await main.getByLabel("Fecha de inicio").fill(new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }));

      const contrato = main.getByRole("region", { name: "Contrato" });
      await contrato.getByRole("checkbox", { name: `${descripcion}: sin contrato` }).check();
      await page.getByRole("button", { name: "Confirmar" }).click();
      const dialogo = page.getByRole("dialog").filter({ hasText: `¿Emitir OS ${siguiente}?` });
      await expect(dialogo.locator('dt:text-is("Contrato") + dd')).toHaveText("No");
      await dialogo.getByRole("button", { name: "Sí" }).click();
      await page.waitForURL(new RegExp(`/logistica/ordenes/${obra}/${siguiente}`));
      expect(sql1(`select sin_contrato from items where id = ${item}`)).toBe("t");
      await expect(page.getByRole("region", { name: "Contrato" })).toContainText("No lleva");
    } finally {
      sql(`delete from oc_items where obra_id = ${obra} and numero_oc = '${siguiente}'; delete from ordenes_compra where obra_id = ${obra} and numero = '${siguiente}';
           update items set sin_contrato = false where id = ${item};`);
    }
  });
});
