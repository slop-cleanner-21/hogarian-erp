import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Cambiar el presupuesto (migración prod1_precios_fijos): en cotización la orden lo sigue; con precios aprobados no se mueve.
// En los dos casos Logística recibe un aviso en esa orden. Todo en transacciones que se revierten.

/** Una línea con su partida en una orden de ese estado, cuyo cotizado esté dentro del presupuesto. */
function linea(estado: string, tipo = "OC") {
  const f = sql(
    `select l.id, l.obra_id, l.numero_oc, l.partida_id, l.pu_cotizado, p.etapa, p.requerimiento, p.item_id, p.cantidad
       from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc join partidas p on p.id = l.partida_id
      where o.estado = '${estado}' and o.tipo = '${tipo}' and not o.es_retencion and l.pu_aprobado is null and l.pu_cotizado > 0 and p.pu >= l.pu_cotizado
      order by o.obra_id desc, o.numero, l.id limit 1`,
  )[0];
  if (!f) return null;
  const [id, obra, numero, partida, cotizado, etapa, requerimiento, item, cantidad] = f;
  return { id, obra, numero, partida, cotizado: Number(cotizado), etapa, requerimiento, item, cantidad };
}
type Linea = NonNullable<ReturnType<typeof linea>>;

/** Gerencia guarda la partida con ese P.U. */
const guardar = (l: Linea, pu: number) => `select set_config('request.jwt.claims', '{"sub":"${uidDe("GERENCIA")}","role":"authenticated"}', true) is null;
    set local role authenticated;
    select guardar_partidas(${l.obra}, '[{"id":${l.partida},"etapa":"${l.etapa}","requerimiento":"${l.requerimiento}","item_id":${l.item},"cantidad":${l.cantidad},"pu":${pu}}]'::jsonb, null);
    reset role;`;

const estadoLinea = (l: Linea, marca: string) =>
  `select '${marca}', coalesce(v.parcial::text, 'sin valor'), v.sobreprecio, (select sum(coalesce(parcial, 0)) from v_oc_items_calc x where x.obra_id = v.obra_id and x.numero_oc = v.numero_oc) from v_oc_items_calc v where v.id = ${l.id};`;

const avisos = (l: Linea) =>
  `select 'aviso', n.titulo, n.href, n.cuerpo from notificaciones n where n.tipo = 'PRECIO_PRESUPUESTO' and n.href like '/logistica/ordenes/${l.obra}/${l.numero}?%' and n.user_id = '${uidDe("LOGISTICA")}';`;

const fila = (filas: string[][], marca: string) => filas.find((f) => f[0] === marca);

test.describe("@precios el presupuesto y las órdenes", () => {
  test.beforeEach(async ({}, info) => {
    test.skip(info.project.name !== "m390", "basta con un tamaño");
  });

  test("con precios aprobados, bajar el presupuesto no mueve la orden, ni pagada ni por pagar; Logística recibe el aviso", () => {
    for (const estado of ["RECIBIDA", "PRECIOS_CONFIRMADOS"]) {
      const l = linea(estado);
      test.skip(!l, `sin OC ${estado}`);
      const r = sqlScript(`begin;
        ${estadoLinea(l!, "antes")}
        ${guardar(l!, l!.cotizado * 0.5)}
        ${estadoLinea(l!, "despues")}
        ${avisos(l!)}
        rollback;`);
      expect(fila(r, "despues")?.slice(1), `${estado}: línea y total`).toEqual(fila(r, "antes")?.slice(1));
      expect(fila(r, "despues")?.[2], "sin sobreprecio").toBe("f");
      const aviso = fila(r, "aviso");
      expect(aviso?.[1]).toBe(`Cambió el presupuesto de la OC ${l!.numero}: sus precios no cambian`);
      expect(aviso?.[2]).toBe(`/logistica/ordenes/${l!.obra}/${l!.numero}?tipo=OC`);
      expect(aviso?.[3]).toContain("→ S/ ");
    }
  });

  test("también una OS aprobada, que no tiene tolerancia", () => {
    const l = linea("RECIBIDA", "OS");
    test.skip(!l, "sin OS recibida");
    const r = sqlScript(`begin; ${estadoLinea(l!, "antes")} ${guardar(l!, l!.cotizado * 0.99)} ${estadoLinea(l!, "despues")} rollback;`);
    expect(fila(r, "despues")?.slice(1)).toEqual(fila(r, "antes")?.slice(1));
  });

  test("en cotización la orden sigue al presupuesto y Logística recibe el aviso", () => {
    const l = linea("PRECIOS_CONFIRMADOS");
    test.skip(!l, "sin OC");
    // La misma orden, de vuelta en cotización (como un rechazo por precios): deja de estar fija.
    const r = sqlScript(`begin;
      update ordenes_compra set estado = 'EMITIDA' where obra_id = ${l!.obra} and numero = '${l!.numero}';
      select 'suelta', count(*) filter (where precio_fijado_at is null), count(*) from oc_items where obra_id = ${l!.obra} and numero_oc = '${l!.numero}';
      ${guardar(l!, l!.cotizado * 0.5)}
      ${estadoLinea(l!, "despues")}
      ${avisos(l!)}
      rollback;`);
    const [, sueltas, todas] = fila(r, "suelta")!;
    expect(sueltas).toBe(todas);
    expect(fila(r, "despues")?.[1], "ya no alcanza el precio").toBe("sin valor");
    expect(fila(r, "despues")?.[2], "sobreprecio").toBe("t");
    expect(fila(r, "aviso")?.[1]).toBe(`Cambió el presupuesto de la OC ${l!.numero}: rige para su cotización`);
  });

  test("al aprobarse queda fijo con el presupuesto de ese momento", () => {
    const l = linea("PRECIOS_CONFIRMADOS");
    test.skip(!l, "sin OC");
    const r = sqlScript(`begin;
      update ordenes_compra set estado = 'EMITIDA' where obra_id = ${l!.obra} and numero = '${l!.numero}';
      update partidas set pu = ${l!.cotizado} where id = ${l!.partida};
      update ordenes_compra set estado = 'PRECIOS_CONFIRMADOS' where obra_id = ${l!.obra} and numero = '${l!.numero}';
      select 'fija', (precio_fijado_at is not null), pu_fijado from oc_items where id = ${l!.id};
      update partidas set pu = ${l!.cotizado * 0.5} where id = ${l!.partida};
      ${estadoLinea(l!, "despues")}
      rollback;`);
    expect(fila(r, "fija")?.[1]).toBe("t");
    expect(Number(fila(r, "fija")?.[2])).toBeCloseTo(l!.cotizado, 4);
    expect(fila(r, "despues")?.[2], "sin sobreprecio").toBe("f");
    expect(fila(r, "despues")?.[1]).not.toBe("sin valor");
  });

  test("guardar sin cambiar el P.U. no avisa, y una orden anulada tampoco", () => {
    const l = linea("RECIBIDA");
    test.skip(!l, "sin OC");
    const pu = Number(sql1(`select pu from partidas where id = ${l!.partida}`));
    expect(sqlScript(`begin; ${guardar(l!, pu)} ${avisos(l!)} rollback;`).filter((f) => f[0] === "aviso"), "mismo P.U.").toEqual([]);
    expect(
      sqlScript(`begin;
        update ordenes_compra set estado = 'ANULADA', motivo_anulacion = 'e2e' where obra_id = ${l!.obra} and numero = '${l!.numero}';
        ${guardar(l!, pu * 2)} ${avisos(l!)} rollback;`).filter((f) => f[0] === "aviso"),
      "anulada",
    ).toEqual([]);
  });

  test("subir el presupuesto tampoco mueve nada", () => {
    const l = linea("RECIBIDA");
    test.skip(!l, "sin OC");
    const r = sqlScript(`begin; ${estadoLinea(l!, "antes")} ${guardar(l!, l!.cotizado * 3)} ${estadoLinea(l!, "despues")} rollback;`);
    expect(fila(r, "despues")?.slice(1)).toEqual(fila(r, "antes")?.slice(1));
  });

  test("Logística puede elegir ese aviso; nadie escribe lo fijado por la API", async ({ abrir }) => {
    const page = await abrir("logistica", "/avisos");
    await page.getByRole("button", { name: "Elegir avisos" }).click();
    const aviso = page.getByRole("dialog", { name: "Elegir avisos" }).getByRole("listitem", { name: "Gerencia cambió un precio del presupuesto" });
    await expect(aviso.getByRole("switch", { name: "Avisar" })).toHaveAttribute("aria-checked", "true");

    const l = linea("RECIBIDA");
    test.skip(!l, "sin OC");
    const antes = sql1(`select pu_fijado from oc_items where id = ${l!.id}`);
    sqlScript(`begin;
      select set_config('request.jwt.claims', '{"sub":"${uidDe("LOGISTICA")}","role":"authenticated"}', true) is null;
      set local role authenticated;
      update oc_items set pu_fijado = 999999 where id = ${l!.id};
      commit;`);
    expect(sql1(`select pu_fijado from oc_items where id = ${l!.id}`)).toBe(antes);
  });

  test("tolerancia: una OS histórica usa la del ítem, como el Excel; una OS nueva no tiene", () => {
    // Del Excel: una OS sobre el presupuesto pero dentro de la tolerancia vale lo cotizado, aunque tenga otro aprobado.
    const f = sql(
      `select c.id, c.cantidad, c.pu_cotizado, c.parcial, c.sobreprecio from v_oc_items_calc c join ordenes_compra o on o.obra_id = c.obra_id and o.numero = c.numero_oc
        where o.tipo = 'OS' and o.historico and c.pu_partida is not null and c.pu_cotizado > c.pu_partida + 0.001 and c.pu_cotizado <= c.pu_max
        order by c.id limit 1`,
    )[0];
    expect(f, "hay una OS histórica dentro de su tolerancia").toBeTruthy();
    expect(Number(f[3])).toBeCloseTo(Number(f[1]) * Number(f[2]), 1);
    expect(f[4]).toBe("f");
    expect(sql1(`select count(*) from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc join partidas p on p.id = l.partida_id join items i on i.id = p.item_id
                  where o.tipo = 'OS' and o.historico and l.precio_fijado_at is not null and l.tol_fijada is distinct from i.tolerancia_pct`), "todas las históricas").toBe("0");

    // Nueva: un céntimo sobre el presupuesto ya es sobreprecio, aunque el ítem tenga 5 % de tolerancia.
    const n = sql(
      `select l.id, l.partida_id, l.obra_id, l.numero_oc from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc join partidas p on p.id = l.partida_id
        where o.tipo = 'OS' and not o.historico and o.estado = 'EMITIDA' and p.pu > 0 order by l.id limit 1`,
    )[0];
    expect(n, "hay una OS nueva en cotización").toBeTruthy();
    const r = sqlScript(`begin;
      update items i set tolerancia_pct = 0.05 from partidas p where p.item_id = i.id and p.id = ${n[1]};
      update oc_items l set pu_cotizado = p.pu + 0.01, pu_aprobado = null from partidas p where p.id = l.partida_id and l.id = ${n[0]};
      select 'nueva', sobreprecio, tolerancia_pct from v_oc_items_calc where id = ${n[0]};
      rollback;`);
    expect(fila(r, "nueva")?.[1]).toBe("t");
    expect(Number(fila(r, "nueva")?.[2])).toBe(0);
  });
});
