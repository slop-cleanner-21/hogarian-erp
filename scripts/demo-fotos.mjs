// Reemplaza las fotos de entregas de las obras demo por ilustraciones planas (PNG «FOTO DEMO») según
// el grupo de materiales o servicios del ítem. Idempotente: se puede correr las veces que haga falta.
// Uso:  npm run db:demo-fotos
import { createClient } from "@supabase/supabase-js";
import { fotoDemoPng, grupoFoto } from "./lib/fotos-demo.mjs";

const OBRAS_DEMO = ["DEMO HOGARIAN", "RESIDENCIAL LOS ÁLAMOS"];
const LOTE = 6;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SECRET_KEY;
if (!url || !clave) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local");
const db = createClient(url, clave, { auth: { persistSession: false } });

const ok = (r, ctx) => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};

const obras = ok(await db.from("obras").select("id, nombre").in("nombre", OBRAS_DEMO), "obras");
if (!obras.length) {
  console.log("No hay obras demo.");
  process.exit(0);
}

const SELECT =
  "id, entrega_id, path, entregas!inner(obra_id, numero_oc, cantidad, created_at, rol, oc_item_id, oc_items(partidas(items(descripcion, unidad, tipo_material, rubro))))";
const fotos = [];
for (let desde = 0; ; desde += 1000) {
  const pagina = ok(
    await db
      .from("entrega_fotos")
      .select(SELECT)
      .in("entregas.obra_id", obras.map((o) => o.id))
      .order("entrega_id")
      .order("id")
      .range(desde, desde + 999),
    "fotos",
  );
  fotos.push(...pagina);
  if (pagina.length < 1000) break;
}

// Índice de cada foto dentro de su entrega (define la variante y el nombre del archivo).
const indice = new Map();
const totales = new Map();
for (const f of fotos) totales.set(f.entrega_id, (totales.get(f.entrega_id) ?? 0) + 1);
const tareas = fotos.map((f) => {
  const n = indice.get(f.entrega_id) ?? 0;
  indice.set(f.entrega_id, n + 1);
  return { f, n, total: totales.get(f.entrega_id) };
});

const porGrupo = {};
async function procesar({ f, n, total }) {
  const e = f.entregas;
  const item = e.oc_items?.partidas?.items ?? {};
  const grupo = grupoFoto(item.tipo_material, item.rubro);
  const png = await fotoDemoPng({
    grupo,
    descripcion: item.descripcion ?? "",
    fecha: e.created_at,
    variante: n,
    totalFotos: total,
  });
  const path = `entregas/${e.obra_id}/${e.numero_oc}/demo-${f.entrega_id}-${n + 1}.png`;
  ok(await db.storage.from("documentos").upload(path, png, { contentType: "image/png", upsert: true }), `subir ${path}`);
  if (f.path !== path) {
    ok(await db.from("entrega_fotos").update({ path }).eq("id", f.id), `foto ${f.id}`);
    ok(await db.storage.from("documentos").remove([f.path]), `borrar ${f.path}`);
  }
  ok(await db.from("datos_demo").upsert({ tabla: "entrega_fotos", registro_id: String(f.id), archivo: path }, { onConflict: "tabla,registro_id" }), "datos_demo");
  porGrupo[grupo] = (porGrupo[grupo] ?? 0) + 1;
}

for (let i = 0; i < tareas.length; i += LOTE) await Promise.all(tareas.slice(i, i + LOTE).map(procesar));

console.log(`Fotos demo: ${tareas.length} (obras ${obras.map((o) => o.id).join(", ")})`);
for (const [g, c] of Object.entries(porGrupo).sort()) console.log(`  ${g.padEnd(12)} ${c}`);
