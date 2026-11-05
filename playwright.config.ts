import { defineConfig, devices } from "@playwright/test";

// Suite e2e: la app ya corriendo en producción (npm run build && npm start) y Supabase local.
// Claves solo por entorno: ERP_DEMO (pantalla de acceso) y ERP_PASS (usuarios de prueba).
//   npm run test:e2e                     todo, en paralelo, en los dos tamaños
//   npm run test:e2e -- --grep @tesoreria  solo un área
//   npm run test:e2e -- --project=m390   un solo tamaño (más rápido mientras se itera)
const BASE = process.env.BASE ?? "http://localhost:3100";
const movil = devices["iPhone 13"];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // 10 por defecto (medido: 1:44 contra 2:10 con 6, con la RAM sobrada). Si el MVP corre a la vez (dos stacks
  // de Supabase y dos Next), WORKERS=6.
  workers: Number(process.env.WORKERS ?? 10),
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  // SALIDA separa los resultados de corridas simultáneas (Playwright vacía su carpeta al empezar).
  outputDir: `test-results/${process.env.SALIDA ?? "e2e"}`,
  // Una barra de avance (tests/e2e/progreso.ts); con REPORTE=list, cada prueba en su línea.
  reporter: [
    process.env.REPORTE === "list" ? ["list"] : ["./tests/e2e/progreso.ts"],
    ["json", { outputFile: `test-results/${process.env.SALIDA ?? "e2e"}.json` }],
  ],
  use: {
    baseURL: BASE,
    locale: "es-PE",
    timezoneId: "America/Lima",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "sesiones", testMatch: /sesiones\.setup\.ts/ },
    {
      name: "m390",
      dependencies: ["sesiones"],
      testIgnore: [/sesiones\.setup\.ts/, /flujo\.spec\.ts/, /concurrencia\.spec\.ts/],
      use: { ...movil, browserName: "chromium", viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
    {
      name: "m360",
      dependencies: ["sesiones"],
      testIgnore: [/sesiones\.setup\.ts/, /flujo\.spec\.ts/, /concurrencia\.spec\.ts/],
      use: {
        ...movil,
        browserName: "chromium",
        viewport: { width: 360, height: 780 },
        screen: { width: 360, height: 780 },
        colorScheme: "dark",
      },
    },
    // El flujo completo crea una obra publicada, un proveedor y órdenes: corre solo, después de los demás (las
    // pruebas que comparan listas con SQL verían la obra a medio crear). Las de concurrencia también: pagan, rechazan y
    // cotizan órdenes de los datos de prueba (y las dejan como estaban) mientras nadie más las toca.
    {
      name: "flujo",
      dependencies: ["m390", "m360"],
      testMatch: /(flujo|concurrencia)\.spec\.ts/,
      use: { ...movil, browserName: "chromium", viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
  ],
});
