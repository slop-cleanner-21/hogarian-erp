import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Retención de 4ta, detracción y comprobante de una OS: las hace cumplir la base (migración prod1_impuestos_base), no
// solo la pantalla. Cada caso corre como Logística dentro de una transacción que se revierte (no deja comprobantes).
//   · Retención de 4ta: solo recibos por honorarios de más de S/ 1,500, por el % del proveedor, salvo suspensión
//     vigente (del mismo año y desde su fecha). La calcula la base; si llega otra, la rechaza diciendo cuál es.
//   · Detracción: solo facturas de más del mínimo (S/ 700; 700 exactos no) con ítems que la llevan; si corresponde,
//     no puede ser 0 (Logística puede ajustar el monto al de la factura).
//   · OS: factura o recibo por honorarios; con el otro, el contrato se regenera en la misma transacción.

type Caso = { sql: string[]; leer?: string };

/** Una orden con precios confirmados y sin comprobante, de ese tipo (con su primer ítem del presupuesto). */
function ordenPorFacturar(tipo: "OC" | "OS") {
  const f = sql(
    `select o.obra_id, o.numero, o.proveedor_id from ordenes_compra o
      where o.tipo = '${tipo}' and o.estado = 'PRECIOS_CONFIRMADOS' and not o.es_retencion and o.valorizacion_id is null
        and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        and exists (select 1 from oc_items l join partidas p on p.id = l.partida_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
        and not exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and (l.pu_bruto is not null or l.ret_garantia_pct > 0))
      order by o.obra_id desc, o.numero limit 1`,
  )[0];
  if (!f) return null;
  const [obra, numero, proveedor] = f;
  const items = sql(`select id from oc_items where obra_id = ${obra} and numero_oc = '${numero}' order by id`).map(([i]) => i);
  return { obra, numero, proveedor, items };
}
type Orden = NonNullable<ReturnType<typeof ordenPorFacturar>>;

/**
 * Corre cada caso como Logística, cada uno en su propio intento que se revierte, y devuelve por caso «ok|detracción|
 * retención» (o lo que lea `leer`, con %s = id del comprobante) o «error|mensaje». En las sentencias, $ID es el id del
 * comprobante registrado antes. `preparar` corre antes, como postgres (y también se revierte).
 */
function probar(casos: Caso[], preparar = "") {
  const uid = uidDe("LOGISTICA");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const filas = sqlScript(`begin;
    create function pg_temp.intento(p_sql text[], p_leer text) returns text language plpgsql as $f$
    declare v_id bigint; v_t text; r text; s text;
    begin
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
        set local role authenticated;
        foreach s in array p_sql loop
          execute replace(s, '$ID', coalesce(v_id::text, 'null')) into v_t;
          if v_t ~ '^\\d+$' then v_id := v_t::bigint; end if;
        end loop;
        reset role;
        execute format(p_leer, coalesce(v_id::text, 'null')) into r;
        raise exception using errcode = 'P0099', message = 'ok|' || coalesce(r, '');
      exception
        when sqlstate 'P0099' then return sqlerrm;
        when others then return 'error|' || sqlerrm;
      end;
    end $f$;
    ${preparar}
    ${casos
      .map(
        (c, i) =>
          `select 'caso${i}|' || pg_temp.intento(array[${c.sql.map(q).join(", ")}]::text[], ${q(c.leer ?? "select detraccion || '|' || retencion from comprobantes where id = %s")});`,
      )
      .join("\n")}
    rollback;`);
  return casos.map((_, i) => {
    const f = filas.find((x) => x[0] === `caso${i}`);
    return f ? f.slice(1) : ["sin resultado"];
  });
}

let serie = 0;
/** registrar_comprobante de la orden (todos sus ítems). */
function registrar(o: Orden, tipo: string, total: number, extra: { retencion?: number | null; detraccion?: number | null; fecha?: string } = {}) {
  serie++;
  const ret = extra.retencion === undefined ? "null" : extra.retencion === null ? "null" : extra.retencion;
  const det = extra.detraccion == null ? "null" : extra.detraccion;
  return `select registrar_comprobante(${o.proveedor}, '${tipo}', 'E${String(serie).padStart(3, "0")}', 'IMP-${serie}', ${extra.fecha ?? "current_date"},
    ${total}, ${ret}, 'e2e/impuestos.pdf', array[${o.items.join(",")}]::bigint[], ${det})`;
}

/** Un ítem de la orden lleva detracción del 10 % (en la obra de la orden). */
const conDetraccion = (o: Orden) => `insert into detracciones (obra_id, item_id, porcentaje)
    select ${o.obra}, p.item_id, 10 from oc_items l join partidas p on p.id = l.partida_id where l.id = ${o.items[0]}
    on conflict (obra_id, item_id) do update set porcentaje = 10;`;

/** Sin detracción en ningún ítem de la orden. */
const sinDetraccion = (o: Orden) => `delete from detracciones d using oc_items l join partidas p on p.id = l.partida_id
    where l.obra_id = ${o.obra} and l.numero_oc = '${o.numero}' and d.obra_id = l.obra_id and d.item_id = p.item_id;`;

/** Proveedor con su % de 4ta y su suspensión (fecha SQL o null). */
const proveedor = (o: Orden, pct: number, suspension: string | null) =>
  `update proveedores set retencion_4ta_pct = ${pct}, suspension_4ta_fecha = ${suspension ?? "null"},
     suspension_4ta_path = ${suspension ? "'proveedores/e2e/suspension.pdf'" : "null"}, suspension_4ta_operacion = null where id = ${o.proveedor};`;

/**
 * Lo que pesa el ítem con detracción en la orden (el parcial de todas sus líneas sobre el total), para calcular la
 * esperada. Una orden puede tener el mismo ítem en varias líneas (partidas de etapas distintas): todas la llevan.
 */
const peso = (o: Orden) =>
  Number(
    sql1(`select sum(parcial) filter (where item_id = (select item_id from v_oc_items_calc where id = ${o.items[0]})) / sum(parcial)
            from v_oc_items_calc where obra_id = ${o.obra} and numero_oc = '${o.numero}'`),
  );
const esperada = (o: Orden, total: number) => Math.round(total * peso(o) * 10) / 100;

test.describe("@impuestos retención de 4ta, detracción y comprobante de OS en la base", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("detracción: más del mínimo (no 700 exactos), solo facturas, y si corresponde no puede ser 0", () => {
    const o = ordenPorFacturar("OC");
    test.skip(!o, "sin OC por facturar");
    const minimo = Number(sql1("select detraccion_minimo from parametros"));
    const r = probar(
      [
        { sql: [registrar(o!, "FACTURA", minimo)] },
        { sql: [registrar(o!, "FACTURA", minimo + 0.01)] },
        { sql: [registrar(o!, "FACTURA", minimo, { detraccion: 10 })] },
        { sql: [registrar(o!, "FACTURA", 5000, { detraccion: 0 })] },
        { sql: [registrar(o!, "FACTURA", 5000, { detraccion: 123.45 })] },
        { sql: [registrar(o!, "RXH", 1000, { detraccion: 50 })] },
        { sql: [registrar(o!, "RXH", 1000)] },
        { sql: [registrar(o!, "BOLETA", 5000)] },
      ],
      conDetraccion(o!) + proveedor(o!, 8, null),
    );
    expect(r[0], `factura de S/ ${minimo}`).toEqual(["ok", "0.00", "0.00"]);
    expect(r[1][0]).toBe("ok");
    expect(Number(r[1][1]), "factura de un céntimo más").toBeCloseTo(esperada(o!, minimo + 0.01), 2);
    expect(Number(r[1][1])).toBeGreaterThan(0);
    expect(r[2], "bajo el mínimo no se acepta una detracción").toEqual(["error", "Este comprobante no lleva detracción"]);
    expect(r[3][0], "si corresponde, no puede ser 0").toBe("error");
    expect(r[3][1]).toMatch(/^Esta factura lleva detracción \(S\/ [\d,]+\.\d\d\)$/);
    expect(r[4], "el monto de la factura (ajustado por Logística)").toEqual(["ok", "123.45", "0.00"]);
    expect(r[5], "un recibo por honorarios nunca").toEqual(["error", "Este comprobante no lleva detracción"]);
    expect(r[6]).toEqual(["ok", "0.00", "0.00"]);
    expect(r[7], "una boleta tampoco").toEqual(["ok", "0.00", "0.00"]);

    // Sin ítems con detracción, ni una factura grande la lleva.
    const [sinItems] = probar([{ sql: [registrar(o!, "FACTURA", 5000, { detraccion: 100 })] }], sinDetraccion(o!));
    expect(sinItems).toEqual(["error", "Este comprobante no lleva detracción"]);
  });

  test("retención de 4ta: la calcula la base y rechaza otra (más de S/ 1,500, % del proveedor, suspensión)", () => {
    const o = ordenPorFacturar("OC");
    test.skip(!o, "sin OC por facturar");
    const base = sinDetraccion(o!);
    const normal = probar(
      [
        { sql: [registrar(o!, "RXH", 2000, { retencion: 160 })] },
        { sql: [registrar(o!, "RXH", 2000, { retencion: 0 })] },
        { sql: [registrar(o!, "RXH", 2000, { retencion: null })] },
        { sql: [registrar(o!, "RXH", 1500, { retencion: 0 })] },
        { sql: [registrar(o!, "RXH", 1500, { retencion: 120 })] },
        { sql: [registrar(o!, "RXH", 1500.01, { retencion: 120 })] },
        { sql: [registrar(o!, "FACTURA", 2000, { retencion: 160 })] },
        { sql: [registrar(o!, "FACTURA", 2000, { retencion: 0 })] },
      ],
      base + proveedor(o!, 8, null),
    );
    expect(normal[0], "8 % de S/ 2,000").toEqual(["ok", "0.00", "160.00"]);
    expect(normal[1], "sin retener").toEqual(["error", "La retención de 4ta de este recibo es S/ 160.00"]);
    expect(normal[2], "sin decirla: la calcula").toEqual(["ok", "0.00", "160.00"]);
    expect(normal[3], "S/ 1,500 exactos no").toEqual(["ok", "0.00", "0.00"]);
    expect(normal[4]).toEqual(["error", "Este comprobante no lleva retención de 4ta"]);
    expect(normal[5], "un céntimo más sí").toEqual(["ok", "0.00", "120.00"]);
    expect(normal[6], "una factura no").toEqual(["error", "Este comprobante no lleva retención de 4ta"]);
    expect(normal[7]).toEqual(["ok", "0.00", "0.00"]);

    const [propio] = probar([{ sql: [registrar(o!, "RXH", 2000, { retencion: 160 })] }], base + proveedor(o!, 10, null));
    expect(propio, "% propio del proveedor").toEqual(["error", "La retención de 4ta de este recibo es S/ 200.00"]);

    const hoy = "current_date";
    const suspendido = probar(
      [
        { sql: [registrar(o!, "RXH", 2000, { retencion: 0 })] },
        { sql: [registrar(o!, "RXH", 2000, { retencion: 160 })] },
        // Un recibo de antes de la suspensión sí se retiene.
        { sql: [registrar(o!, "RXH", 2000, { retencion: 160, fecha: `${hoy} - 2` })] },
        // El día de su emisión tampoco cubre: rige desde el siguiente.
        { sql: [registrar(o!, "RXH", 2000, { retencion: 160, fecha: `${hoy} - 1` })] },
      ],
      base + proveedor(o!, 8, `${hoy} - 1`),
    );
    expect(suspendido[0], "con suspensión vigente").toEqual(["ok", "0.00", "0.00"]);
    expect(suspendido[1]).toEqual(["error", "Este comprobante no lleva retención de 4ta"]);
    expect(suspendido[2], "recibo anterior a la suspensión").toEqual(["ok", "0.00", "160.00"]);
    expect(suspendido[3], "recibo del mismo día de la suspensión").toEqual(["ok", "0.00", "160.00"]);

    const [vencida] = probar(
      [{ sql: [registrar(o!, "RXH", 2000, { retencion: 0 })] }],
      base + proveedor(o!, 8, "(date_trunc('year', current_date) - interval '1 day')::date"),
    );
    expect(vencida, "suspensión del año pasado").toEqual(["error", "La retención de 4ta de este recibo es S/ 160.00"]);
  });

  test("OS: factura con su detracción, recibo con su retención; nada más; con el otro, el contrato se regenera", () => {
    const o = ordenPorFacturar("OS");
    test.skip(!o, "sin OS por facturar");
    const actual = sql1(`select comprobante_tipo from ordenes_compra where obra_id = ${o!.obra} and numero = '${o!.numero}'`);
    const otro = actual === "FACTURA" ? "RXH" : "FACTURA";
    const contrato = `select comprobante_tipo || '|' || (contrato_enviado_at is null) || '|' ||
        (select count(*) from adjuntos where tipo = 'CONTRATO' and obra_id = ${o!.obra} and numero_oc = '${o!.numero}')
        from ordenes_compra where obra_id = ${o!.obra} and numero = '${o!.numero}' and %s is not null`;
    const r = probar(
      [
        { sql: [registrar(o!, "FACTURA", 5000)] },
        { sql: [registrar(o!, "RXH", 5000)] },
        { sql: [registrar(o!, "BOLETA", 5000)] },
        { sql: [registrar(o!, otro, 5000)], leer: contrato },
      ],
      conDetraccion(o!) +
        proveedor(o!, 8, null) +
        // Un contrato firmado y enviado, para ver que se quita.
        `update ordenes_compra set contrato_enviado_at = now() where obra_id = ${o!.obra} and numero = '${o!.numero}';
         insert into adjuntos (obra_id, numero_oc, tipo, path, nombre) values (${o!.obra}, '${o!.numero}', 'CONTRATO', 'e2e/contrato.pdf', 'Contrato firmado');`,
    );
    expect(r[0][0]).toBe("ok");
    expect(Number(r[0][1]), "factura de S/ 5,000").toBeCloseTo(esperada(o!, 5000), 2);
    expect(r[0][2]).toBe("0.00");
    expect(r[1], "recibo de S/ 5,000").toEqual(["ok", "0.00", "400.00"]);
    expect(r[2]).toEqual(["error", "El comprobante de una OS es factura o recibo por honorarios"]);
    expect(r[3], `${actual || "sin comprobante"} → ${otro}: otro contrato, sin el firmado`).toEqual(["ok", otro, actual ? "true" : "false", actual ? "0" : "1"]);
  });

  test("corregir un comprobante: mismas reglas de retención, detracción y OS", () => {
    const o = ordenPorFacturar("OC");
    test.skip(!o, "sin OC por facturar");
    const minimo = Number(sql1("select detraccion_minimo from parametros"));
    const editar = (tipo: string, total: number, retencion: number | null, fecha = "current_date") =>
      `select editar_comprobante($ID, '${tipo}', 'E999', '999', ${fecha}, ${total}, ${retencion ?? "null"}, null, 'e2e')`;
    const r = probar(
      [
        { sql: [registrar(o!, "RXH", 2000), editar("RXH", 3000, 160)] },
        { sql: [registrar(o!, "RXH", 2000), editar("RXH", 3000, 240)] },
        { sql: [registrar(o!, "RXH", 2000), editar("RXH", 3000, null)] },
        { sql: [registrar(o!, "RXH", 2000), editar("FACTURA", 2000, 160)] },
        { sql: [registrar(o!, "FACTURA", 5000), editar("RXH", 5000, 400)] },
        { sql: [registrar(o!, "FACTURA", minimo + 100), editar("FACTURA", minimo - 1, 0)] },
        { sql: [registrar(o!, "FACTURA", minimo - 1), editar("FACTURA", 5000, 0)] },
        // Sin cambiar tipo, fecha ni total, la retención queda como estaba aunque el proveedor cambie de %.
        {
          sql: [
            registrar(o!, "RXH", 2000),
            `select set_config('role', 'postgres', true) is null`,
            `update proveedores set retencion_4ta_pct = 10 where id = ${o!.proveedor} returning 'x'`,
            `select set_config('role', 'authenticated', true) is null`,
            editar("RXH", 2000, 160),
          ],
        },
      ],
      conDetraccion(o!) + proveedor(o!, 8, null),
    );
    expect(r[0]).toEqual(["error", "La retención de 4ta de este recibo es S/ 240.00"]);
    expect(r[1]).toEqual(["ok", "0.00", "240.00"]);
    expect(r[2], "sin decirla: la calcula").toEqual(["ok", "0.00", "240.00"]);
    expect(r[3], "a factura, sin retención").toEqual(["error", "Este comprobante no lleva retención de 4ta"]);
    expect(r[4], "de factura a recibo: sin detracción, con retención").toEqual(["ok", "0.00", "400.00"]);
    expect(r[5], "bajo el mínimo: sin detracción").toEqual(["ok", "0.00", "0.00"]);
    expect(r[6][0]).toBe("ok");
    expect(Number(r[6][1]), "sobre el mínimo: con la calculada").toBeCloseTo(esperada(o!, 5000), 2);
    expect(r[7], "sin cambios que la afecten").toEqual(["ok", "0.00", "160.00"]);

    const os = ordenPorFacturar("OS");
    if (os) {
      const [boleta] = probar([{ sql: [registrar(os, "RXH", 1000), editar("BOLETA", 1000, null)] }], proveedor(os, 8, null));
      expect(boleta).toEqual(["error", "El comprobante de una OS es factura o recibo por honorarios"]);
    }
  });

  test("suspensión de 4ta del proveedor: solo con la constancia subida y sin fecha futura (también por la API)", () => {
    const o = ordenPorFacturar("OC");
    test.skip(!o, "sin OC por facturar");
    const actualizar = (path: string, fecha: string) =>
      `update proveedores set suspension_4ta_fecha = ${fecha}, suspension_4ta_path = '${path}', suspension_4ta_operacion = null where id = ${o!.proveedor} returning id`;
    const leer = `select suspension_4ta_fecha from proveedores where id = ${o!.proveedor} and %s is not null`;
    const r = probar(
      [
        { sql: [actualizar("proveedores/e2e/no-existe.pdf", "current_date")], leer },
        { sql: [actualizar("guias/e2e/constancia.pdf", "current_date")], leer },
        { sql: [actualizar("proveedores/e2e/constancia.pdf", "current_date + 1")], leer },
        { sql: [actualizar("proveedores/e2e/constancia.pdf", "current_date")], leer },
      ],
      `insert into storage.objects (bucket_id, name) values ('documentos', 'proveedores/e2e/constancia.pdf'), ('documentos', 'guias/e2e/constancia.pdf');`,
    );
    expect(r[0], "sin el archivo").toEqual(["error", "Sube la constancia de suspensión de 4ta"]);
    expect(r[1], "fuera de la carpeta de proveedores").toEqual(["error", "Sube la constancia de suspensión de 4ta"]);
    expect(r[2]).toEqual(["error", "La fecha de la constancia no puede ser futura"]);
    expect(r[3][0]).toBe("ok");
    expect(r[3][1]).toBe(sql1("select current_date"));
  });

  test("suspensión de 4ta: basta el N° de operación, y un proveedor nuevo toma la que se conoce por su RUC o DNI", () => {
    const o = ordenPorFacturar("OC");
    test.skip(!o, "sin OC por facturar");
    const conOperacion = (op: string) =>
      `update proveedores set suspension_4ta_fecha = current_date, suspension_4ta_path = null, suspension_4ta_operacion = ${op} where id = ${o!.proveedor} returning id`;
    const leer = `select suspension_4ta_operacion from proveedores where id = ${o!.proveedor} and %s is not null`;
    const nuevo = (cod: string) => `insert into proveedores (ruc_o_cod, razon_social) values ('${cod}', 'E2E SUSPENSION') returning id`;
    const leerNuevo = `select suspension_4ta_fecha || '|' || suspension_4ta_operacion from proveedores where id = %s`;
    const r = probar(
      [
        { sql: [conOperacion("'12345678'")], leer },
        { sql: [conOperacion("'12'")], leer },
        { sql: [conOperacion("null")], leer },
        { sql: [nuevo("10999999991")], leer: leerNuevo },
        { sql: [nuevo("99999999")], leer: leerNuevo },
        { sql: [nuevo("10999999992")], leer: `select coalesce(suspension_4ta_fecha::text, 'sin') from proveedores where id = %s` },
      ],
      `insert into suspensiones_4ta (ruc, fecha, numero_operacion) values ('10999999991', '2026-01-05', '11111111'), ('10999999991', '2026-02-05', '22222222');
       update proveedores set suspension_4ta_path = null, suspension_4ta_fecha = null, suspension_4ta_operacion = null where id = ${o!.proveedor};`,
    );
    expect(r[0], "con el N° de operación, sin archivo").toEqual(["ok", "12345678"]);
    expect(r[1][0], "solo dígitos, de 6 a 12").toBe("error");
    expect(r[2], "sin constancia ni N°").toEqual(["error", "Sube la constancia de suspensión de 4ta o ingresa su N° de operación"]);
    expect(r[3], "por RUC, la más reciente").toEqual(["ok", "2026-02-05", "22222222"]);
    expect(r[4], "por el DNI del RUC 10").toEqual(["ok", "2026-02-05", "22222222"]);
    expect(r[5], "de los demás se asume que no la tiene").toEqual(["ok", "sin"]);
  });

  test("pantalla: al corregir un comprobante la retención se muestra calculada y se guarda la que corresponde", async ({ abrir }) => {
    const fila = sql(
      `select o.obra_id, o.numero, c.id, o.proveedor_id from comprobantes c
         join oc_items l on l.comprobante_id = c.id join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
        where o.tipo = 'OC' and o.estado = 'FACTURADA' and c.tipo = 'FACTURA'
          and not exists (select 1 from pago_aplicaciones p where p.comprobante_id = c.id)
          and not exists (select 1 from asientos a where a.comprobante_id = c.id)
          and (select count(distinct (l2.obra_id, l2.numero_oc)) from oc_items l2 where l2.comprobante_id = c.id) = 1
        order by o.obra_id desc, o.numero desc limit 1`,
    )[0];
    test.skip(!fila, "sin OC facturada con su factura por corregir");
    const [obra, numero, id, prov] = fila;
    const antes = sql1(`select row_to_json(c)::text from (select tipo, serie, numero, fecha_emision, total, retencion, detraccion, base, igv, periodo_anotacion from comprobantes where id = ${id}) c`);
    const [pct, fechaS, pathS, opS] = sql(`select retencion_4ta_pct, coalesce(suspension_4ta_fecha::text, ''), coalesce(suspension_4ta_path, ''), coalesce(suspension_4ta_operacion, '') from proveedores where id = ${prov}`)[0];
    try {
      sql(`update proveedores set retencion_4ta_pct = 8, suspension_4ta_fecha = null, suspension_4ta_path = null, suspension_4ta_operacion = null where id = ${prov}`);
      const page = await abrir("logistica", `/logistica/ordenes/${obra}/${numero}?tipo=OC`);
      await page.getByRole("button", { name: "Corregir comprobante" }).first().click();
      const hoja = page.getByRole("dialog", { name: "Corregir comprobante" });
      // Una factura no muestra retención.
      await expect(hoja.getByLabel(/^Retención 4ta/)).toHaveCount(0);
      await hoja.getByRole("button", { name: "Tipo" }).click();
      await page.getByRole("listbox", { name: "Tipo" }).getByRole("option", { name: "Recibo por honorarios", exact: true }).click();
      await hoja.getByLabel("Total").fill("1500");
      await expect(hoja.getByLabel("Retención 4ta (8 %)")).toHaveValue("S/ 0.00");
      await hoja.getByLabel("Total").fill("2000");
      const campo = hoja.getByLabel("Retención 4ta (8 %)");
      await expect(campo).toHaveValue("S/ 160.00");
      await expect(campo).toHaveAttribute("readonly", "");
      await hoja.getByLabel("Motivo de la corrección").fill("e2e impuestos");
      await hoja.getByRole("button", { name: "Guardar corrección" }).click();
      await expect(hoja).toBeHidden();
      expect(sql(`select tipo, total, retencion, detraccion from comprobantes where id = ${id}`)[0]).toEqual(["RXH", "2000.00", "160.00", "0.00"]);
    } finally {
      sql(`update proveedores set retencion_4ta_pct = ${pct}, suspension_4ta_fecha = ${fechaS ? `'${fechaS}'` : "null"}, suspension_4ta_path = ${pathS ? `'${pathS}'` : "null"}, suspension_4ta_operacion = ${opS ? `'${opS}'` : "null"} where id = ${prov};
           update comprobantes c set tipo = a.tipo, serie = a.serie, numero = a.numero, fecha_emision = a.fecha_emision, total = a.total,
                  retencion = a.retencion, base = a.base, igv = a.igv, periodo_anotacion = a.periodo_anotacion
             from json_populate_record(null::comprobantes, '${antes.replace(/'/g, "''")}') a where c.id = ${id};
           update comprobantes c set detraccion = a.detraccion from json_populate_record(null::comprobantes, '${antes.replace(/'/g, "''")}') a where c.id = ${id};
           delete from comprobantes_historial where comprobante_id = ${id} and motivo = 'e2e impuestos';`);
    }
  });
});

test.describe("@impuestos la retención de 4ta se hace al pagar", () => {
  test("la suspensión subida después del recibo quita la retención mientras no esté pagado; uno ya pagado no cambia", () => {
    const [id, prov] = sql(`select c.id, c.proveedor_id from comprobantes c
                             where c.tipo = 'RXH' and c.anulado_at is null and not c.historico and c.retencion > 0
                               and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = c.id)
                               and not exists (select 1 from asientos s where s.comprobante_id = c.id)
                             order by c.id limit 1`)[0] ?? [];
    test.skip(!id, "sin recibos por pagar con retención");
    const pagado = sql1(`select c.id from comprobantes c where c.tipo = 'RXH' and c.retencion > 0 and c.proveedor_id = ${prov}
                           and exists (select 1 from pago_aplicaciones a where a.comprobante_id = c.id) limit 1`);
    const leer = (cid: string) => `(select retencion from comprobantes where id = ${cid})`;
    // Como Logística sube la suspensión (con su N° de operación), de ayer: hoy ya rige.
    const r = sqlScript(`begin;
      select set_config('app.skip_audit', 'on', true) is null;
      select ${leer(id)}${pagado ? ` || '|' || ${leer(pagado)}` : ""};
      update proveedores set suspension_4ta_fecha = (now() at time zone 'America/Lima')::date - 1, suspension_4ta_path = null,
                             suspension_4ta_operacion = '123456' where id = ${prov};
      select ${leer(id)}${pagado ? ` || '|' || ${leer(pagado)}` : ""};
      update proveedores set suspension_4ta_fecha = null, suspension_4ta_operacion = null where id = ${prov};
      select ${leer(id)};
      rollback;`);
    const [antes, con, sin] = r.slice(-3);
    expect(Number(antes[0])).toBeGreaterThan(0);
    expect(con[0], "con la suspensión vigente, sin retención").toBe("0.00");
    if (pagado) expect(con[1], "el ya pagado no cambia").toBe(antes[1]);
    expect(sin[0], "sin la suspensión vuelve").toBe(antes[0]);
  });

  test("al abrir la orden se recalcula (la suspensión rige desde el día siguiente): solo Tesorería, Logística y Gerencia", () => {
    const o = sql(`select i.obra_id, i.numero_oc from oc_items i join comprobantes c on c.id = i.comprobante_id
                    where c.tipo = 'RXH' and c.anulado_at is null and not c.historico limit 1`)[0];
    test.skip(!o, "sin órdenes con recibo");
    const como = (rol: string) =>
      sqlScript(`begin;
        select set_config('request.jwt.claims', '{"sub":"${uidDe(rol)}","role":"authenticated"}', true) is null;
        set local role authenticated;
        select refrescar_retencion_orden(${o[0]}, '${o[1]}');
        rollback;`).at(-1)![0];
    expect(como("TESORERIA")).toMatch(/^\d+$/);
    expect(() => como("JEFE_OPERACIONES")).toThrow(/No tienes permiso/);
  });
});
