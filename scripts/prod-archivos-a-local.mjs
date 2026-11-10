// Copia los archivos de producción (comprobantes, vouchers, guías, contratos, firmas…) al almacenamiento LOCAL, para que se
// abran en local después de scripts/prod-a-local.sh. Lee de stdin la lista «bucket|nombre» (la de storage.objects).
// Solo lee producción. Las claves salen de .env.produccion.local y .env.local (fuera del repo); no se imprimen.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const leer = (archivo) =>
  Object.fromEntries(
    fs
      .readFileSync(archivo, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
  );
const prod = leer(".env.produccion.local");
const local = leer(".env.local");
if (!prod.NEXT_PUBLIC_SUPABASE_URL?.includes(".supabase.co")) throw new Error("La URL de producción no es de Supabase");
if (local.NEXT_PUBLIC_SUPABASE_URL?.includes(".supabase.co")) throw new Error(".env.local apunta a la nube: este script solo escribe en local");

const opciones = { auth: { persistSession: false } };
const origen = createClient(prod.NEXT_PUBLIC_SUPABASE_URL, prod.SUPABASE_SECRET_KEY, opciones);
const destino = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.SUPABASE_SECRET_KEY, opciones);

const lista = fs
  .readFileSync(0, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split("|"));
let copiados = 0;
const fallas = [];
for (const [bucket, nombre] of lista) {
  const { data, error } = await origen.storage.from(bucket).download(nombre);
  if (error) {
    fallas.push(`${bucket}/${nombre}: ${error.message}`);
    continue;
  }
  const { error: e2 } = await destino.storage
    .from(bucket)
    .upload(nombre, Buffer.from(await data.arrayBuffer()), { upsert: true, contentType: data.type || undefined });
  if (e2) fallas.push(`${bucket}/${nombre}: ${e2.message}`);
  else copiados++;
}
console.log(`Archivos copiados: ${copiados} de ${lista.length}`);
for (const f of fallas) console.log(`  no se copió ${f}`);
if (fallas.length) process.exitCode = 1;
