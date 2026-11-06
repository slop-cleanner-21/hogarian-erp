// Sube el .xlsm original como plantilla del export (bucket privado «excel»: solo el servidor lo lee; tiene RUCs y cuentas
// bancarias reales, por eso no va en el repo). Debe ser el MISMO archivo con el que se generó excel.sql: el export escribe
// sobre sus filas. Después de cargar un Excel nuevo, hay que subirlo también.
//   npm run excel:plantilla -- "<ruta>.xlsm"                                           local
//   node --env-file=.env.produccion.local scripts/subir-plantilla-excel.mjs "<ruta>.xlsm"  producción
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ruta = process.argv[2];
if (!ruta || !fs.existsSync(ruta)) {
  console.error('Uso: npm run excel:plantilla -- "<ruta>.xlsm"');
  process.exit(2);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await db.storage
  .from("excel")
  .upload("plantilla.xlsm", fs.readFileSync(ruta), { upsert: true, contentType: "application/vnd.ms-excel.sheet.macroEnabled.12" });
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log("Plantilla subida");
