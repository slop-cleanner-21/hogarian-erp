import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Sugerencia de Logística: en una OS se puede cambiar el proveedor hasta que se le envía el contrato al maestro.

/** Una OS en cotización o por facturar, sin contrato enviado ni comprobante. */
const os = (estado: string) =>
  sql(`select o.obra_id, o.numero, o.proveedor_id from ordenes_compra o
        where o.tipo = 'OS' and not o.es_retencion and o.estado = '${estado}' and o.contrato_enviado_at is null
          and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
          and not exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero)
        order by o.obra_id, o.numero limit 1`)[0];
const otro = (prov: string) => sql1(`select id from proveedores where id <> ${prov} and comprobante_habitual = 'FACTURA' order by id limit 1`);

test.describe("@logistica cambiar el proveedor de una OS", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
  });

  test("en la base: hasta el envío del contrato; el link anterior deja de servir; en cotización vuelve al presupuesto", () => {
    const f = os("PRECIOS_CONFIRMADOS");
    test.skip(!f, "sin OS por facturar");
    const [obra, numero, prov] = f!;
    const nuevo = otro(prov);
    const log = uidDe("LOGISTICA");
    const filas = sqlScript(`begin;
      create function pg_temp.t(p_sql text) returns text language plpgsql as $f$
      declare r text;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${log}', 'role', 'authenticated')::text, true);
        set local role authenticated;
        execute p_sql into r;
        reset role;
        return coalesce(r, '');
      exception when others then return 'error: ' || sqlerrm;
      end $f$;
      create temp table antes as select token_cotizacion from ordenes_compra where obra_id = ${obra} and numero = '${numero}';
      select 'cambio|' || pg_temp.t($q$select cambiar_proveedor_orden(${obra}, '${numero}', ${nuevo})$q$);
      select 'despues|' || proveedor_id || '|' || (token_cotizacion <> (select token_cotizacion from antes)) || '|' || comprobante_tipo
        from ordenes_compra where obra_id = ${obra} and numero = '${numero}';
      select 'mismo|' || pg_temp.t($q$select cambiar_proveedor_orden(${obra}, '${numero}', ${nuevo})$q$);
      update ordenes_compra set contrato_enviado_at = now() where obra_id = ${obra} and numero = '${numero}';
      select 'enviado|' || pg_temp.t($q$select cambiar_proveedor_orden(${obra}, '${numero}', ${prov})$q$);
      rollback;`);
    const r = Object.fromEntries(filas.map(([k, ...v]) => [k, v.join("|")]));
    expect(r.cambio).toBe("");
    expect(r.despues, "otro proveedor, otro link, su comprobante habitual").toBe(`${nuevo}|true|FACTURA`);
    expect(r.mismo).toBe("error: Es el mismo proveedor");
    expect(r.enviado).toBe("error: El proveedor ya no se cambia: el contrato ya se le envió o la OS ya tiene su comprobante");
  });

  test("en pantalla: «Cambiar proveedor» en el menú de la OS", async ({ abrir }) => {
    const f = os("PRECIOS_CONFIRMADOS");
    test.skip(!f, "sin OS por facturar");
    const [obra, numero, prov] = f!;
    const nuevo = otro(prov);
    const [razon] = sql(`select razon_social from proveedores where id = ${nuevo}`)[0];
    const [token, tipoComp] = sql(`select token_cotizacion, coalesce(comprobante_tipo::text, '') from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)[0];
    try {
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${encodeURIComponent(numero)}?tipo=OS`);
      await page.getByRole("button", { name: "Más opciones" }).click();
      await page.getByRole("button", { name: "Cambiar proveedor" }).click();
      const hoja = page.getByRole("dialog", { name: "Cambiar proveedor" });
      await expect(hoja.getByRole("status", { name: "Lo que falta" })).toHaveText("Falta: proveedor");
      await hoja.getByRole("button", { name: "Nuevo proveedor", exact: true }).click();
      await page.getByLabel("Buscar Nuevo proveedor", { exact: true }).fill(razon.slice(0, 25));
      await page.getByRole("listbox", { name: "Nuevo proveedor" }).getByRole("option", { name: razon }).first().click();
      await hoja.getByRole("button", { name: "Cambiar proveedor" }).click();
      await expect(hoja).toBeHidden();
      await expect.poll(() => sql1(`select proveedor_id from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe(nuevo);
      await expect(page.locator("main")).toContainText(razon);
    } finally {
      sql(`update ordenes_compra set proveedor_id = ${prov}, token_cotizacion = '${token}', comprobante_tipo = ${tipoComp ? `'${tipoComp}'` : "null"}
            where obra_id = ${obra} and numero = '${numero}'`);
    }
  });
});
