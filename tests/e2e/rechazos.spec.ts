import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sql, sql1 } from "./lib";

// Rechazo de Tesorería y reenvío, de punta a punta y con las dos personas: Tesorería rechaza (eligiendo qué
// corregir), Logística lo ve en su lista y en la orden, corrige lo mínimo y la orden vuelve; Tesorería la ve
// «Reenviada» con lo que se corrigió, y todo queda en el historial. Cada prueba deja la orden como estaba.

/** OC en Tesorería que se puede rechazar por cualquier motivo: normal, sin pagos, su factura solo de ella y sin guía pendiente. */
function ordenParaRechazar(salto: number) {
  return sql(
    `select o.obra_id, o.numero, b.empresa_id from ordenes_compra o join obras b on b.id = o.obra_id
      where o.tipo = 'OC' and o.estado = 'EN_TESORERIA' and not o.historico and not o.requiere_guia
        and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is not null)
        and not exists (select 1 from oc_items l join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id where l.obra_id = o.obra_id and l.numero_oc = o.numero)
        and not exists (select 1 from oc_items l join oc_items x on x.comprobante_id = l.comprobante_id
                         where l.obra_id = o.obra_id and l.numero_oc = o.numero and (x.obra_id, x.numero_oc) <> (o.obra_id, o.numero))
        and not exists (select 1 from rechazos r where r.obra_id = o.obra_id and r.numero = o.numero and r.reenviado_at is null)
      order by o.obra_id desc, o.numero offset ${salto} limit 1`,
  )[0];
}

/** Lo que hay que reponer al final: las líneas con su factura, la factura sin anular y los rechazos y avisos nuevos. */
function foto(obra: string, numero: string) {
  const lineas = sql(`select id, comprobante_id from oc_items where obra_id = ${obra} and numero_oc = '${numero}' and comprobante_id is not null`);
  const ultimoRechazo = sql1("select coalesce(max(id), 0) from rechazos");
  const ultimoComp = sql1("select coalesce(max(id), 0) from comprobantes");
  const ultimoAviso = sql1("select coalesce(max(id), 0) from notificaciones");
  // Solo lo de esta orden: las pruebas corren en paralelo.
  return () => {
    const nuevos = sql(`select distinct comprobante_id from oc_items where obra_id = ${obra} and numero_oc = '${numero}'
                          and comprobante_id > ${ultimoComp}`).map(([c]) => c);
    sql(`update oc_items l set comprobante_id = v.c from (values ${lineas.map(([i, c]) => `(${i}, ${c})`).join(",")}) v(i, c) where l.id = v.i;
         ${nuevos.length ? `delete from comprobantes where id in (${nuevos.join(",")});` : ""}
         update comprobantes set anulado_at = null, anulado_motivo = null where id in (${lineas.map(([, c]) => c).join(",")});
         delete from rechazos where id > ${ultimoRechazo} and obra_id = ${obra} and numero = '${numero}';
         delete from notificaciones where id > ${ultimoAviso} and href like '%/${obra}/${numero}%';
         update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = ${obra} and numero = '${numero}';`);
  };
}

async function rechazar(page: Page, correccion: RegExp, motivo: string) {
  await page.getByRole("button", { name: "Rechazar", exact: true }).click();
  const hoja = page.locator("dialog[open]").last();
  await hoja.getByRole("radio", { name: correccion }).check();
  await hoja.getByLabel("Motivo").fill(motivo);
  await hoja.getByRole("button", { name: "Rechazar", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/tesoreria");
}

const filaLogistica = (page: Page, obra: string, numero: string) => page.locator(`main a[href^='/logistica/ordenes/${obra}/${numero}']`).first();

test.describe("@prod1 @rechazos rechazo y reenvío", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "m390", "escribe en la base"));

  test("datos o documentos: vuelve con su factura; Logística la reenvía con una nota y Tesorería la ve «Reenviada»", async ({ abrir }) => {
    const [obra, numero, empresa] = ordenParaRechazar(0);
    const reponer = foto(obra, numero);
    const motivo = `Corregir la cuenta bancaria del proveedor (${Date.now()})`;
    const nota = "Se corrigió la cuenta bancaria en la ficha del proveedor";
    try {
      const tes = await abrir("tesoreria", `/tesoreria/pago/${obra}/${numero}`);
      await rechazar(tes, /^Datos o documentos/, motivo);
      expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`), "vuelve a «Guía», con su factura").toBe("FACTURADA");

      // Logística: la ve «Rechazada» en su pestaña, con el motivo en la orden. Corregir y reenviar: 3 toques.
      const log = await abrir("logistica", `/logistica?tipo=OC&tab=fact&obra=${obra}`);
      await expect(filaLogistica(log, obra, numero)).toContainText("Rechazada");
      await filaLogistica(log, obra, numero).click();
      const aviso = log.getByRole("alert").filter({ hasText: "Rechazada por Tesorería" });
      await expect(aviso).toContainText("corrige y reenvíala");
      await expect(log.locator("main dl").first()).toContainText("Rechazada, por corregir");
      await expect(aviso).toContainText(motivo);
      await log.getByRole("button", { name: "Reenviar a Tesorería" }).click();
      const confirmar = log.getByRole("dialog").filter({ hasText: "¿Reenviar a Tesorería?" });
      await confirmar.getByLabel("Qué se corrigió").fill(nota);
      await confirmar.getByRole("button", { name: "Sí" }).click();
      await expect.poll(() => sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("EN_TESORERIA");

      // Queda registrado: quién rechazó, qué corregir, cuándo se reenvió, quién y qué se corrigió.
      expect(
        sql(`select r.correccion, t.rol, l.rol, r.nota_reenvio, r.reenviado_at is not null from rechazos r
               join perfiles t on t.user_id = r.created_by join perfiles l on l.user_id = r.reenviado_by
              where r.obra_id = ${obra} and r.numero = '${numero}' order by r.id desc limit 1`),
      ).toEqual([["DATOS", "TESORERIA", "LOGISTICA", nota, "t"]]);
      expect(Number(sql1(`select count(*) from notificaciones where tipo = 'REENVIO' and href = '/tesoreria/pago/${obra}/${numero}'`))).toBeGreaterThan(0);

      // Tesorería: «Reenviada» en Por pagar y, en la orden, lo que se corrigió y el rechazo.
      const lista = await abrir("tesoreria", `/tesoreria?empresa=${empresa}&area=log&obra=${obra}`);
      await expect(lista.locator(`main a[href^='/tesoreria/pago/${obra}/${numero}']`).first()).toContainText("Reenviada");
      const pago = await abrir("tesoreria", `/tesoreria/pago/${obra}/${numero}`);
      const reenviada = pago.getByRole("region", { name: "Reenviada" });
      await expect(reenviada).toContainText(nota);
      await expect(reenviada).toContainText(motivo);
      await pago.getByText(/^Rechazos \(\d+\)$/).click();
      await expect(pago.locator("ol li").first()).toContainText("Corregir: Datos o documentos");
      await expect(pago.locator("ol li").first()).toContainText("Reenviada el");
    } finally {
      reponer();
    }
  });

  test("la factura: vuelve a «Facturar» con sus precios; la factura nueva la manda sola", async ({ abrir }) => {
    const [obra, numero] = ordenParaRechazar(1);
    const reponer = foto(obra, numero);
    const motivo = `El total de la factura no coincide con la orden (${Date.now()})`;
    try {
      const tes = await abrir("tesoreria", `/tesoreria/pago/${obra}/${numero}`);
      await rechazar(tes, /^La factura/, motivo);
      expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`), "sin volver a confirmar precios").toBe("PRECIOS_CONFIRMADOS");

      // Logística: «Rechazada» en «Facturar»; registra la factura nueva y vuelve sola a Tesorería.
      const log = await abrir("logistica", `/logistica?tipo=OC&tab=prec&obra=${obra}`);
      await expect(filaLogistica(log, obra, numero)).toContainText("Rechazada");
      await filaLogistica(log, obra, numero).click();
      const aviso = log.getByRole("alert").filter({ hasText: "Rechazada por Tesorería" });
      await expect(aviso).toContainText("registra la factura nueva");
      await expect(aviso).toContainText("Anulada:");
      await log.getByRole("button", { name: "Registrar comprobante" }).click();
      const hoja = log.getByRole("dialog", { name: "Comprobante" });
      await hoja.getByLabel("Serie").fill("F998");
      await hoja.getByLabel("Número").fill(String(Date.now() % 100000000));
      await hoja.locator('input[type="file"]').setInputFiles(path.resolve("public/empresas/ariant.png"));
      await hoja.getByRole("button", { name: "Registrar y enviar a Tesorería" }).click();
      await expect(hoja).toBeHidden();
      await expect.poll(() => sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("EN_TESORERIA");
      expect(sql1(`select correccion || ' ' || (reenviado_at is not null) from rechazos where obra_id = ${obra} and numero = '${numero}' order by id desc limit 1`)).toBe("FACTURA true");
    } finally {
      reponer();
    }
  });

  test("los precios: vuelve a cotización (lo único que justifica volver tan atrás)", async ({ abrir }) => {
    const [obra, numero] = ordenParaRechazar(2);
    const reponer = foto(obra, numero);
    const motivo = `El precio del cemento no es el cotizado (${Date.now()})`;
    try {
      const tes = await abrir("tesoreria", `/tesoreria/pago/${obra}/${numero}`);
      await rechazar(tes, /^Los precios/, motivo);
      expect(sql1(`select estado from ordenes_compra where obra_id = ${obra} and numero = '${numero}'`)).toBe("EMITIDA");
      const log = await abrir("logistica", `/logistica?tipo=OC&tab=cot&obra=${obra}`);
      await expect(filaLogistica(log, obra, numero)).toContainText("Rechazada");
      await filaLogistica(log, obra, numero).click();
      await expect(log.getByRole("alert").filter({ hasText: "Rechazada por Tesorería" })).toContainText("revisa los precios");
    } finally {
      reponer();
    }
  });
});
