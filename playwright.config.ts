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
  // 6 por defecto: prod1 suele correr junto al MVP (dos stacks de Supabase y dos Next) y con 10 se satura la RAM.
  workers: Number(process.env.WORKERS ?? 6),
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  // SALIDA separa los resultados de corridas simultáneas (Playwright vacía su carpeta al empezar).
  outputDir: `test-results/${process.env.SALIDA ?? "e2e"}`,
  reporter: [["list"], ["json", { outputFile: `test-results/${process.env.SALIDA ?? "e2e"}.json` }]],
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
      testIgnore: [/sesiones\.setup\.ts/, /flujo\.spec\.ts/],
      use: { ...movil, browserName: "chromium", viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
    {
      name: "m360",
      dependencies: ["sesiones"],
      testIgnore: [/sesiones\.setup\.ts/, /flujo\.spec\.ts/],
      use: {
        ...movil,
        browserName: "chromium",
        viewport: { width: 360, height: 780 },
        screen: { width: 360, height: 780 },
        colorScheme: "dark",
      },
    },
    // El flujo completo crea una obra publicada, un proveedor y órdenes: corre solo, después de los demás (las
    // pruebas que comparan listas con SQL verían la obra a medio crear).
    {
      name: "flujo",
      dependencies: ["m390", "m360"],
      testMatch: /flujo\.spec\.ts/,
      use: { ...movil, browserName: "chromium", viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
  ],
});
