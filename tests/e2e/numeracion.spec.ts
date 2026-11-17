import { expect, test } from "./fixtures";
import { sql, sqlScript } from "./lib";

// N° de las OC y OS: una sola serie por empresa (20261117120000_prod1_numeracion_empresa). Todo corre en una transacción que se
// deshace.

/** Las filas marcadas con 'R' de un bloque que se deshace. */
const enTransaccion = (cuerpo: string) =>
  sqlScript(`begin;\n${cuerpo};\nrollback;`)
    .filter((f) => f[0] === "R")
    .map((f) => f.slice(1));

const intento = (q: string) => `do $$ begin ${q}; raise exception 'ok'; exception when others then
  perform set_config('e2e.error', sqlerrm, true); end $$; select 'R', current_setting('e2e.error')`;

test.describe("@logistica numeración de órdenes por empresa", () => {
  test("dos obras de una empresa comparten la serie; no se repite un N° en la empresa; los repetidos sin salir se corrigen", () => {
    const [a, b, empresa] = sql(
      `select min(id), max(id), empresa_id from obras group by empresa_id having count(*) >= 2 order by empresa_id limit 1`,
    )[0];
    const otra = sql(`select o.id from obras o where o.empresa_id <> ${empresa} order by o.id limit 1`)[0][0];
    const prov = sql("select id from proveedores order by id limit 1")[0][0];
    const r = enTransaccion(`
      select 'R', siguiente_numero_oc(${a}) = siguiente_numero_oc(${b});
      select set_config('e2e.n', siguiente_numero_oc(${a}), true);
      insert into ordenes_compra (obra_id, numero, proveedor_id, tipo) values (${a}, current_setting('e2e.n'), ${prov}, 'OC');
      select 'R', siguiente_numero_oc(${b})::bigint - current_setting('e2e.n')::bigint;
      -- Un N° que una orden dejó al cambiar de número no se vuelve a dar (sus links viejos llevan a esa orden).
      insert into ordenes_renumeradas (obra_id, anterior, nuevo) values (${a}, (current_setting('e2e.n')::bigint + 1)::text, current_setting('e2e.n'));
      select 'R', siguiente_numero_oc(${b})::bigint - current_setting('e2e.n')::bigint;
      delete from ordenes_renumeradas where obra_id = ${a} and anterior = (current_setting('e2e.n')::bigint + 1)::text;
      -- Un N° a más de 100 de la serie (como el 100669 o el 1000139 del Excel) no la mueve.
      insert into ordenes_compra (obra_id, numero, proveedor_id, tipo) values (${a}, (current_setting('e2e.n')::bigint + 500)::text, ${prov}, 'OC');
      select 'R', siguiente_numero_oc(${b})::bigint - current_setting('e2e.n')::bigint;
      ${intento(`insert into ordenes_compra (obra_id, numero, proveedor_id, tipo) values (${b}, current_setting('e2e.n'), ${prov}, 'OS')`)};
      ${intento(`insert into ordenes_compra (obra_id, numero, proveedor_id, tipo) values (${otra}, current_setting('e2e.n'), ${prov}, 'OS')`)};
      -- Un repetido que llegó sin pasar la regla (como los de antes del arreglo): la corrección le da el siguiente de la serie.
      select set_config('app.skip_audit', 'on', true);
      insert into ordenes_compra (obra_id, numero, proveedor_id, tipo, created_at)
      values (${b}, current_setting('e2e.n'), ${prov}, 'OS', now() + interval '1 minute');
      select set_config('app.skip_audit', 'off', true);
      select 'R', count(*) from corregir_numeros_repetidos() c where c.obra_id = ${b} and c.anterior = current_setting('e2e.n');
      select 'R', count(*) from ordenes_compra o join obras x on x.id = o.obra_id
       where x.empresa_id = ${empresa} and o.numero = current_setting('e2e.n')`);
    expect(r[0][0], "las dos obras proponen el mismo siguiente").toBe("t");
    expect(r[1][0], "tomado en una obra, la otra sigue con el siguiente").toBe("1");
    expect(r.splice(2, 1)[0][0], "salta el N° que dejó una orden renumerada").toBe("2");
    expect(r[2][0], "un N° fuera de la serie no la mueve").toBe("1");
    expect(r[3][0]).toMatch(/Ya existe una orden N° \d+ en la empresa/);
    expect(r[4][0], "otra empresa sí puede usar el mismo N°").toBe("ok");
    expect(r[5][0], "el repetido sin salir cambia de N°").toBe("1");
    expect(r[6][0], "queda uno solo con ese N°").toBe("1");
  });
});

test.describe("@tesoreria links de una orden que cambió de N°", () => {
  test("el link con el N° viejo lleva a la orden con el N° nuevo; un cambio de N° deja su rastro", async ({ abrir }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base");
    const [obra, numero] = sql(`select obra_id, numero from ordenes_compra where estado = 'EN_TESORERIA' order by obra_id, numero limit 1`)[0];
    sql(`insert into ordenes_renumeradas (obra_id, anterior, nuevo) values (${obra}, 'E2E-VIEJO', '${numero}') on conflict do nothing`);
    try {
      const page = await abrir("tesoreria", `/tesoreria/pago/${obra}/E2E-VIEJO`);
      await expect(page).toHaveURL(new RegExp(`/tesoreria/pago/${obra}/${numero}$`));
      const consulta = await abrir("gerencia", `/consulta/orden/${obra}/E2E-VIEJO`);
      await expect(consulta).toHaveURL(new RegExp(`/consulta/orden/${obra}/${numero}$`));
    } finally {
      sql(`delete from ordenes_renumeradas where obra_id = ${obra} and anterior = 'E2E-VIEJO'`);
    }
    const r = enTransaccion(`
      update ordenes_compra set numero = 'E2E-N1' where obra_id = ${obra} and numero = '${numero}';
      update ordenes_compra set numero = 'E2E-N2' where obra_id = ${obra} and numero = 'E2E-N1';
      select 'R', anterior || '>' || nuevo from ordenes_renumeradas where obra_id = ${obra} and anterior in ('${numero}', 'E2E-N1') order by anterior`);
    expect(r.map((x) => x[0]).sort(), "toda la cadena apunta al último N°").toEqual([`${numero}>E2E-N2`, "E2E-N1>E2E-N2"].sort());
  });
});
