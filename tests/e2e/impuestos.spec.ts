import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Detracción (SPOT) en la base, en OC y en OS: solo facturas, solo si el total supera el mínimo (S/ 700 por defecto,
// «importe mayor a S/ 700»), calculada con el % de los ítems que marcó Gerencia; un recibo por honorarios nunca la
// lleva, aunque se la manden. Todo en transacciones que se revierten (no deja comprobantes).

/** Una orden con precios confirmados y sin comprobante, de ese tipo. */
function ordenPorFacturar(tipo: "OC" | "OS") {
  return sql(
    `select o.obra_id, o.numero, o.proveedor_id from ordenes_compra o
      where o.tipo = '${tipo}' and o.estado = 'PRECIOS_CONFIRMADOS' and not o.es_retencion and o.valorizacion_id is null
        and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        and (select count(*) from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero) > 0
      order by o.obra_id desc, o.numero limit 1`,
  )[0];
}

/**
 * Registra comprobantes de prueba (uno por caso, cada uno en su punto de guardado) como Logística y devuelve la
 * detracción que quedó en cada uno. Un ítem de la orden lleva detracción del 10 %.
 */
function detraccionesDe(obra: string, numero: string, proveedor: string, casos: { tipo: "FACTURA" | "RXH"; total: number; detraccion?: number }[]) {
  const items = sql(`select id from oc_items where obra_id = ${obra} and numero_oc = '${numero}' order by id`).map(([i]) => i);
  const [itemDet] = sql(`select p.item_id from oc_items l join partidas p on p.id = l.partida_id where l.id = ${items[0]}`)[0];
  const filas = sqlScript(`begin;
    insert into detracciones (obra_id, item_id, porcentaje) values (${obra}, ${itemDet}, 10)
      on conflict (obra_id, item_id) do update set porcentaje = 10;
    select set_config('request.jwt.claims', '{"sub":"${uidDe("LOGISTICA")}","role":"authenticated"}', true);
    ${casos
      .map(
        (c, i) => `savepoint c${i};
    set local role authenticated;
    select registrar_comprobante(${proveedor}, '${c.tipo}', 'E2E', 'IMP-${i}', current_date,
      ${c.total}, 0, 'e2e/impuestos-${i}.pdf', array[${items.join(",")}]::bigint[], ${c.detraccion ?? "null"}) as cid \\gset
    reset role;
    select 'caso${i}|' || detraccion from comprobantes where id = :cid;
    rollback to c${i};`,
      )
      .join("\n")}
    rollback;`);
  return casos.map((_, i) => filas.find((f) => f[0] === `caso${i}`)?.[1]);
}

/** Lo que pesa el ítem con detracción en la orden (su parcial sobre el total), para calcular la esperada. */
const peso = (obra: string, numero: string) =>
  Number(
    sql1(`select (select parcial from v_oc_items_calc where obra_id = ${obra} and numero_oc = '${numero}' order by id limit 1) / sum(parcial)
            from v_oc_items_calc where obra_id = ${obra} and numero_oc = '${numero}'`),
  );

test.describe("@impuestos detracción en la base (OC y OS)", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("OC: S/ 700 exactos no llevan detracción; S/ 700.01 sí, con el % del ítem; un recibo por honorarios nunca", () => {
    const fila = ordenPorFacturar("OC");
    test.skip(!fila, "sin OC por facturar");
    const [obra, numero, proveedor] = fila;
    const minimo = Number(sql1("select detraccion_minimo from parametros"));
    const [exacto, encima, rhe, rheForzado] = detraccionesDe(obra, numero, proveedor, [
      { tipo: "FACTURA", total: minimo },
      { tipo: "FACTURA", total: minimo + 0.01 },
      { tipo: "RXH", total: minimo + 1000 },
      { tipo: "RXH", total: minimo + 1000, detraccion: 50 },
    ]);
    expect(Number(exacto), `factura de S/ ${minimo}`).toBe(0);
    expect(Number(encima), "factura de un céntimo más").toBeCloseTo(Math.round((minimo + 0.01) * peso(obra, numero) * 10) / 100, 2);
    expect(Number(encima)).toBeGreaterThan(0);
    expect(Number(rhe), "recibo por honorarios").toBe(0);
    expect(Number(rheForzado), "recibo por honorarios aunque se la manden").toBe(0);
  });

  test("OS con factura: lleva su detracción como una OC; con recibo por honorarios, no", () => {
    const fila = ordenPorFacturar("OS");
    test.skip(!fila, "sin OS por facturar");
    const [obra, numero, proveedor] = fila;
    const total = 5000;
    const [factura, rhe] = detraccionesDe(obra, numero, proveedor, [
      { tipo: "FACTURA", total },
      { tipo: "RXH", total },
    ]);
    expect(Number(factura)).toBeCloseTo(Math.round(total * peso(obra, numero) * 10) / 100, 2);
    expect(Number(factura)).toBeGreaterThan(0);
    expect(Number(rhe)).toBe(0);
  });
});
