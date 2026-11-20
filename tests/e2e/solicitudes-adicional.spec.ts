import { expect, test } from "./fixtures";
import { sql, sql1, sqlScript } from "./lib";

// Prod 1: Logística pide adicionales y Gerencia los aprueba (una, todas las filtradas) o los rechaza con su motivo. Al
// aprobarse, cada solicitud es el siguiente «Adicional N» de su obra, en el orden en que se pidieron.

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const como = (rol: string, q: string) => {
  const uid = sql1(`select user_id from perfiles where rol = '${rol}' limit 1`);
  return sqlScript(`begin; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is null;
                    set local role authenticated; ${q}; commit;`);
};

test.describe("@prod1 solicitudes de adicionales", () => {
  test("Logística pide un adicional; Gerencia rechaza uno y aprueba todos los demás de la obra", async ({ abrir, revisarPantalla }, info) => {
    test.skip(info.project.name !== "m390", "escribe en la base: corre en un solo proyecto");
    const [obra, nombreObra, itemId, descripcion] = sql(`select o.id, o.nombre, i.id, i.descripcion from obras o
        join partidas p on p.obra_id = o.id join items i on i.id = p.item_id
       where o.nombre like '%(PROD 1)' and o.presupuesto_estado = 'PUBLICADO' and i.rubro = 'MATERIAL' order by p.id limit 1`)[0];
    const motivo = `E2E MAYOR METRADO ${Date.now() % 1000000}`;
    const n = Number(sql1(`select coalesce(max(substring(requerimiento from '^ADIC (\\d+)$')::int), 0) + 1 from partidas where obra_id = ${obra}`));
    try {
      // Logística la pide desde su pantalla.
      const log = await abrir("logistica", "/logistica/adicionales");
      await expect(log.getByRole("link", { name: "Adicionales", exact: true })).toHaveAttribute("aria-current", "page");
      await log.getByRole("button", { name: "Pedir adicional" }).click();
      const hoja = log.getByRole("dialog", { name: "Pedir adicional" });
      await expect(hoja.getByRole("status", { name: "Lo que falta" })).toContainText("obra");
      await hoja.getByRole("button", { name: "Obra", exact: true }).click();
      await log.getByRole("listbox", { name: "Obra" }).getByRole("option").filter({ hasText: nombreObra }).first().click();
      await hoja.getByLabel("Motivo").fill(motivo);
      await hoja.getByRole("button", { name: "Ítem", exact: true }).click();
      await log.getByLabel("Buscar Ítem").fill(descripcion);
      await log.getByRole("listbox", { name: "Ítem" }).getByRole("option").filter({ hasText: new RegExp(`^${escRe(descripcion)}`) }).first().click();
      await hoja.getByLabel("Cantidad partida 1").fill("3");
      await hoja.getByLabel("P.U. partida 1").fill("12.5");
      await hoja.getByRole("button", { name: /^Enviar a Gerencia/ }).click();
      await expect(hoja).toHaveCount(0);
      await expect(log.locator("main li", { hasText: motivo })).toContainText("S/ 37.50");
      const [id1] = sql(`select id from adicional_solicitudes where motivo = '${motivo}'`)[0];
      expect(Number(sql1(`select count(*) from notificaciones n join perfiles p on p.user_id = n.user_id
                           where p.rol = 'GERENCIA' and n.tipo = 'SOLICITUD_ADICIONAL' and n.cuerpo like '%${motivo}'`))).toBeGreaterThan(0);
      // Dos más, por la base (la segunda se rechaza).
      for (const sufijo of ["B", "C"])
        como("LOGISTICA", `select pedir_adicional(${obra}, '[{"etapa":"L0","item_id":${itemId},"cantidad":1,"pu":5}]', '${motivo} ${sufijo}')`);
      const [id2, id3] = sql(`select id from adicional_solicitudes where motivo like '${motivo} _' order by motivo`).map((r) => r[0]);
      // El Jefe de Operaciones no las lee (llevan precios).
      expect(como("JEFE_OPERACIONES", "select count(*) from adicional_solicitudes").flat().at(-1)).toBe("0");

      // Gerencia: por aprobar de esa obra; rechaza la B con su motivo.
      const ger = await abrir("gerencia", `/gerencia/adicionales?estado=PENDIENTE&obra=${obra}`);
      await revisarPantalla(ger);
      const tarjeta = (m: string) => ger.locator("main ul > li").filter({ has: ger.getByText(m, { exact: true }) });
      await tarjeta(`${motivo} B`).getByRole("button", { name: "Rechazar" }).click();
      const dialogo = ger.getByRole("dialog", { name: "¿Rechazar el adicional?" });
      await expect(dialogo.getByRole("button", { name: "Sí" })).toBeDisabled();
      await dialogo.getByLabel("Motivo del rechazo").fill("Ya está en el presupuesto");
      await dialogo.getByRole("button", { name: "Sí" }).click();
      await expect(tarjeta(`${motivo} B`)).toHaveCount(0);
      // Aprobar todas: la A y la C, en el orden en que se pidieron.
      await ger.getByRole("button", { name: /^Aprobar todas \(2\)/ }).click();
      await ger.getByRole("dialog", { name: "¿Aprobar las 2 solicitudes?" }).getByRole("button", { name: "Sí" }).click();
      await expect(ger.getByRole("status")).toContainText("2 aprobada(s)");
      expect(sql(`select id, estado, coalesce(requerimiento, respuesta) from adicional_solicitudes where id in (${id1}, ${id2}, ${id3}) order by id`)).toEqual([
        [id1, "APROBADA", `ADIC ${n}`],
        [id2, "RECHAZADA", "Ya está en el presupuesto"],
        [id3, "APROBADA", `ADIC ${n + 1}`],
      ]);
      expect(sql1(`select count(*) from partidas where obra_id = ${obra} and requerimiento in ('ADIC ${n}', 'ADIC ${n + 1}')`)).toBe("2");

      // Logística ve la rechazada con su motivo.
      await log.goto("/logistica/adicionales?estado=RECHAZADA");
      await expect(log.locator("main li", { hasText: `${motivo} B` })).toContainText("Ya está en el presupuesto");
    } finally {
      sql(`delete from notificaciones where cuerpo like '%${motivo}%' or titulo like 'Adicional ${n} en %' or titulo like 'Adicional ${n + 1} en %';
           delete from partidas where obra_id = ${obra} and requerimiento in ('ADIC ${n}', 'ADIC ${n + 1}');
           delete from adicional_solicitudes where motivo like '${motivo}%';`);
    }
  });
});
