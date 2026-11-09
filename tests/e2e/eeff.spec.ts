import { comprobacion, resultados, situacion, type Suma } from "../../src/lib/eeff";
import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript, uidDe } from "./lib";

// Estados financieros de Contabilidad (migración prod1_eeff, src/lib/eeff.ts): salen de los asientos de la app. Solo leen.

const centimos = (s: string) => Number(s.replace(/\D/g, "") || 0);
const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const soles = (n: number) => `S/ ${fmt.format(n)}`;

/** La empresa y el mes con asientos más recientes, y las sumas del ejercicio hasta ese mes (como postgres). */
function datos() {
  const fila = sql("select empresa_id, to_char(max(fecha), 'YYYYMM') from asientos group by 1 order by max(fecha) desc limit 1")[0];
  if (!fila) return null;
  const [empresa, hasta] = fila;
  const desde = `${hasta.slice(0, 4)}-01-01`;
  const fin = `(date '${hasta.slice(0, 4)}-${hasta.slice(4)}-01' + interval '1 month - 1 day')::date`;
  const sumas: Suma[] = sql(`select cuenta, coalesce(denominacion, ''), debe, haber from sumas_cuentas(${empresa}, '${desde}', ${fin})`).map(
    ([cuenta, denominacion, debe, haber]) => ({ cuenta, denominacion, debe: Number(debe), haber: Number(haber) }),
  );
  return { empresa, hasta, desde, fin, sumas };
}

test.describe("@contabilidad estados financieros", () => {
  test("con los asientos reales: la comprobación y la situación cuadran, y el resultado es el mismo en los dos estados", () => {
    const d = datos();
    test.skip(!d?.sumas.length, "sin asientos");
    const c = comprobacion(d!.sumas);
    expect(c.cuadra, "Debe = Haber y saldos deudores = acreedores").toBe(true);
    const s = situacion(d!.sumas);
    expect(s.cuadra, "Activo = Pasivo + Patrimonio").toBe(true);
    const r = resultados(d!.sumas);
    expect(s.resultado).toBeCloseTo(r.resultado - r.sinAmarre, 2);
  });

  test("con datos armados: el saldo decide el lado en las clases 1 a 4 y la 79 no entra en resultados", () => {
    const sumas: Suma[] = [
      { cuenta: "961110101", denominacion: "Costo de obra", debe: 100, haber: 0 },
      { cuenta: "40111", denominacion: "IGV", debe: 18, haber: 0 },
      { cuenta: "421210101", denominacion: "Proveedores", debe: 50, haber: 118 },
      { cuenta: "1041", denominacion: "Banco", debe: 0, haber: 50 },
      { cuenta: "639", denominacion: "Servicios", debe: 100, haber: 0 },
      { cuenta: "791", denominacion: "Cargas imputables", debe: 0, haber: 100 },
    ];
    const s = situacion(sumas);
    expect(s.activoCorriente.map((l) => [l.codigo, l.monto])).toEqual([["40", 18]]);
    expect(s.pasivo.map((l) => [l.codigo, l.monto])).toEqual([["10", 50], ["42", 68]]);
    expect(s.resultado).toBe(-100);
    expect(s.cuadra).toBe(true);
    const r = resultados(sumas);
    expect(r.ingresos).toEqual([]);
    expect(r.totalGastos).toBe(100);
    expect(r.resultado).toBe(-100);
    expect(r.totalFuncion).toBe(100);
    expect(r.sinAmarre).toBe(0);
  });

  test("las sumas por cuenta solo las lee Contabilidad", () => {
    const d = datos();
    test.skip(!d?.sumas.length, "sin asientos");
    const contar = (rol: string) =>
      sqlScript(`begin;
        select set_config('request.jwt.claims', '{"sub":"${uidDe(rol)}","role":"authenticated"}', true) is null;
        set local role authenticated;
        select count(*) from sumas_cuentas(${d!.empresa}, '${d!.desde}', ${d!.fin});
        rollback;`).at(-1)![0];
    expect(contar("CONTABILIDAD")).toBe(String(d!.sumas.length));
    for (const rol of ["TESORERIA", "GERENCIA", "LOGISTICA", "JEFE_OPERACIONES"]) expect(contar(rol), rol).toBe("0");
  });

  test("las pantallas muestran lo mismo que la base: comprobación, situación y resultados", async ({ abrir, revisarPantalla }) => {
    const d = datos();
    test.skip(!d?.sumas.length, "sin asientos");
    const c = comprobacion(d!.sumas);
    const s = situacion(d!.sumas);
    const r = resultados(d!.sumas);
    const base = `/contabilidad/eeff?empresa=${d!.empresa}&hasta=${d!.hasta}`;

    const page = await abrir("contabilidad", `${base}&vista=comp`);
    await expect(page.getByRole("link", { name: "EEFF" })).toHaveAttribute("aria-current", "page");
    await revisarPantalla(page);
    await expect(page.locator("main li")).toHaveCount(c.filas.length);
    const totales = page.getByRole("region", { name: "Totales" });
    await expect(totales).toContainText(`Debe${soles(c.totales.debe)}`);
    await expect(totales).toContainText(`Haber${soles(c.totales.haber)}`);

    await page.getByRole("tab", { name: "Situación" }).click();
    const cuadre = page.getByRole("region", { name: "Cuadre" });
    await expect(cuadre).toContainText(`Activo${soles(s.activo)}`);
    await expect(cuadre).toContainText(`Pasivo y patrimonio${soles(s.activo)}`);
    await expect(page.getByRole("region", { name: "Patrimonio" })).toContainText(`Resultado del ejercicio${soles(s.resultado)}`);
    await revisarPantalla(page);

    await page.getByRole("tab", { name: "Resultados" }).click();
    const res = page.getByRole("region", { name: "Resultado" });
    await expect(res).toContainText(soles(r.resultado));
    expect(centimos((await res.innerText()).replace(/^\D+/, ""))).toBe(Math.round(Math.abs(r.resultado) * 100));
    await expect(page.getByRole("region", { name: "Costos y gastos por función (clase 9)" })).toContainText(soles(r.totalFuncion));
    await revisarPantalla(page);
    expect(sql1(`select count(*) from asientos where empresa_id = ${d!.empresa}`)).not.toBe("0");
  });
});
