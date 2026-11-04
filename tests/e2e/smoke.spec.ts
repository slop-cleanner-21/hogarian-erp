import { expect, test } from "./fixtures";
import { sesion, sql, type Rol } from "./lib";

// Smoke de todas las pantallas de cada rol: carga sin redirigir, sin errores de consola ni 4xx/5xx,
// sin textos de error, sin desborde horizontal ni <select> nativo. Una prueba por pantalla, en paralelo.
// Las rutas de detalle se toman de la base (los datos de la demo).
const uno = (q: string) => sql(q)[0] ?? [];
const [ocObra, ocNum] = uno("select obra_id, numero from ordenes_compra where tipo='OC' and estado='RECIBIDA' order by obra_id desc, numero limit 1");
// Prod 1: las OS de mano de obra se crean directo (sin valorización); se toma una OS cualquiera.
const [osObra, osNum] = uno("select obra_id, numero from ordenes_compra where tipo='OS' and estado <> 'ANULADA' order by obra_id desc, numero limit 1");
const [penObra, penNum] = uno("select obra_id, numero from v_por_pagar where estado='PENDIENTE' and doc in ('OC','OS') order by obra_id limit 1");
const [obraGer] = uno("select id from obras order by id desc limit 1");

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
    `/logistica/ordenes/${ocObra}/${ocNum}`,
    `/logistica/ordenes/${osObra}/${osNum}`,
    `/consulta/orden/${ocObra}/${ocNum}`,
    "/avisos",
  ],
  tesoreria: [
    "/tesoreria",
    "/tesoreria?empresa=todas&area=log",
    "/tesoreria?empresa=todas&area=log&est=pag",
    "/tesoreria?empresa=todas&area=log&est=rec",
    `/tesoreria/pago/${penObra}/${penNum}`,
    "/tesoreria/consultas",
    `/consulta/orden/${ocObra}/${ocNum}`,
  ],
  gerencia: [
    "/gerencia/obras",
    `/gerencia/obras/${obraGer}`,
    "/gerencia/presupuesto",
    "/gerencia/ordenes",
    `/consulta/orden/${ocObra}/${ocNum}`,
  ],
  jefe: ["/operaciones"],
};

// Roles fuera de prod 1 y rutas de módulos quitados.
const FUERA: Partial<Record<Rol, string[]>> = {
  contabilidad: ["/", "/contabilidad/op", "/avisos", "/tesoreria"],
  residente: ["/", "/residente", "/avisos"],
  operaciones: ["/", "/operaciones", "/avisos"],
  rrhh: ["/", "/rrhh", "/avisos"],
};
const QUITADAS: [Rol, string][] = [
  ["logistica", "/logistica/requerimientos"],
  ["gerencia", "/gerencia/solicitudes"],
  ["jefe", "/operaciones/requerimientos"],
  ["jefe", "/operaciones/solicitudes"],
  ["jefe", "/operaciones/valorizaciones"],
  ["jefe", "/operaciones/obra"],
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
        const page = await abrir(rol, ruta);
        await revisarPantalla(page);
      });
    }
  });
}
