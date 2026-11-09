import { expect, test } from "./fixtures";
import { sesion, sql, type Rol } from "./lib";

// Smoke de todas las pantallas de cada rol: carga sin redirigir, sin errores de consola ni 4xx/5xx,
// sin textos de error, sin desborde horizontal ni <select> nativo. Una prueba por pantalla, en paralelo.
// Las rutas de detalle se toman de la base (los datos de la demo), DENTRO de cada prueba: los títulos llevan el
// comodín (:oc, :os, :pago, :obra) y no cambian aunque otras pruebas creen o muevan órdenes en paralelo (con el id
// en el título, cada worker armaba títulos distintos y Playwright abortaba: «Test not found in the worker»). Se
// eligen datos que ninguna prueba crea ni borra: órdenes de la carga (sin autor) y obras que no son del flujo.
const uno = (q: string) => sql(q)[0] ?? [];
const DETALLE: Record<string, () => string> = {
  ":oc": () => uno("select obra_id || '/' || numero from ordenes_compra where tipo='OC' and estado='RECIBIDA' and created_by is null order by obra_id desc, numero limit 1")[0],
  // Prod 1: las OS de mano de obra se crean directo (sin valorización); se toma una OS cualquiera de la carga.
  ":os": () => uno("select obra_id || '/' || numero from ordenes_compra where tipo='OS' and estado <> 'ANULADA' and created_by is null order by obra_id desc, numero limit 1")[0],
  ":pago": () => uno("select obra_id || '/' || numero from v_por_pagar where estado='PENDIENTE' and doc in ('OC','OS') order by obra_id, numero limit 1")[0],
  ":obra": () => uno("select id from obras where nombre not like 'E2E %' and nombre not like 'AUDIT%' order by id desc limit 1")[0],
};
const resolver = (ruta: string) => ruta.replace(/:(oc|os|pago|obra)\b/g, (k) => DETALLE[k]());

// Solo los roles de prod 1 tienen pantallas.
const RUTAS: Partial<Record<Rol, string[]>> = {
  logistica: [
    "/logistica",
    "/logistica?tipo=OS",
    "/logistica/proveedores",
    "/logistica/items",
    "/logistica/transportistas",
    "/logistica/ordenes/nueva",
    "/logistica/ordenes/nueva?tipo=OS",
    "/logistica/ordenes/:oc",
    "/logistica/ordenes/:os",
    "/consulta/orden/:oc",
    "/avisos",
  ],
  tesoreria: [
    "/tesoreria",
    "/tesoreria?empresa=todas&area=log",
    "/tesoreria?empresa=todas&area=log&est=pag",
    "/tesoreria?empresa=todas&area=log&est=rec",
    "/tesoreria/pago/:pago",
    "/tesoreria/consultas",
    "/consulta/orden/:oc",
  ],
  gerencia: [
    "/gerencia/obras",
    "/gerencia/obras/:obra",
    "/gerencia/presupuesto",
    "/gerencia/ordenes",
    "/consulta/orden/:oc",
  ],
  contabilidad: [
    "/contabilidad/compras",
    "/contabilidad/pagos",
    "/contabilidad/pagos?tab=con",
    "/contabilidad/op",
    "/contabilidad/impuestos",
    "/contabilidad/impuestos?imp=det&est=pag",
    "/contabilidad/impuestos?imp=ret",
    "/contabilidad/impuestos?imp=ret&est=pag",
    "/contabilidad/eeff",
    "/contabilidad/eeff?vista=comp",
    "/contabilidad/eeff?vista=res",
    "/contabilidad",
    "/contabilidad?tab=con",
    "/contabilidad?tab=plan",
    "/consulta/orden/:oc",
    "/avisos",
  ],
  jefe: ["/operaciones"],
  // El Ingeniero de Operaciones: lo mismo que el Jefe.
  operaciones: ["/operaciones"],
};

// Roles fuera de prod 1 y rutas de módulos quitados.
const FUERA: Partial<Record<Rol, string[]>> = {
  residente: ["/", "/residente", "/avisos"],
  rrhh: ["/", "/rrhh", "/avisos"],
};
const QUITADAS: [Rol, string][] = [
  ["contabilidad", "/contabilidad/guias"],
  ["logistica", "/logistica/requerimientos"],
  ["gerencia", "/gerencia/solicitudes"],
  ["jefe", "/operaciones/requerimientos"],
  ["jefe", "/operaciones/solicitudes"],
  ["jefe", "/operaciones/valorizaciones"],
  ["jefe", "/operaciones/obra"],
  ["operaciones", "/operaciones/requerimientos"],
  ["operaciones", "/operaciones/valorizaciones"],
];

test.describe("@smoke @prod1 fuera de alcance", () => {
  for (const [rol, rutas] of Object.entries(FUERA) as [Rol, string[]][]) {
    test(`${rol} termina en «Sin acceso»`, async ({ browser }, info) => {
      const ctx = await browser.newContext({ ...info.project.use, storageState: sesion(rol) });
      const page = await ctx.newPage();
      for (const ruta of rutas) {
        await page.goto(ruta);
        await expect(page, ruta).toHaveURL((u) => u.pathname === "/sin-acceso" || u.pathname.startsWith("/login"));
      }
      await page.goto("/sin-acceso");
      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await expect(page).toHaveURL(/\/login/);
      await ctx.close();
    });
  }
  for (const [rol, ruta] of QUITADAS)
    test(`${rol} ${ruta} ya no existe`, async ({ browser }, info) => {
      const ctx = await browser.newContext({ ...info.project.use, storageState: sesion(rol) });
      const r = await (await ctx.newPage()).goto(ruta);
      expect(r?.status(), ruta).toBe(404);
      await ctx.close();
    });
});

for (const [rol, rutas] of Object.entries(RUTAS) as [Rol, string[]][]) {
  test.describe(`@smoke @${rol}`, () => {
    for (const ruta of rutas) {
      test(`${rol} ${ruta}`, async ({ abrir, revisarPantalla }) => {
        const page = await abrir(rol, resolver(ruta));
        await revisarPantalla(page);
      });
    }
  });
}
