// Entregas con fotos de la obra DEMO (las fotos van al storage, por eso no caben en el seed SQL).
// Correr después de `npx supabase db reset`:  npm run db:demo-entregas
import { createClient } from "@supabase/supabase-js";
import { fotoDemoPng, grupoFoto } from "./lib/fotos-demo.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SECRET_KEY;
if (!url || !clave) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local");
const db = createClient(url, clave, { auth: { persistSession: false } });

const ok = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const usuario = async (email) => ok(await db.auth.admin.listUsers()).users.find((u) => u.email === email)?.id;
const [residente, logistica] = await Promise.all([usuario("residente@erp.local"), usuario("logistica@erp.local")]);
const obra = ok(await db.from("obras").select("id").eq("nombre", "DEMO HOGARIAN").single()).id;

// Cerca de una obra en Trujillo; la segunda entrega la registra Logística (sin GPS). Las fotos son
// ilustraciones «FOTO DEMO» del grupo de materiales del ítem (mismo generador que npm run db:demo-fotos).
const ENTREGAS = [
  { numero: "900001", cantidad: 300, quien: residente, rol: "RESIDENTE", lat: -8.1116, lng: -79.0288, dias: 9, fotos: 2 },
  { numero: "900001", cantidad: 100, quien: logistica, rol: "LOGISTICA", lat: null, lng: null, dias: 6, fotos: 1 },
];

for (const e of ENTREGAS) {
  const item = ok(await db.from("oc_items").select("id, partidas(items(descripcion, unidad, tipo_material, rubro))").eq("obra_id", obra).eq("numero_oc", e.numero).order("id").limit(1).single());
  const it = item.partidas.items;
  const cuando = new Date(Date.now() - e.dias * 86_400_000).toISOString();
  const entrega = ok(
    await db
      .from("entregas")
      .insert({
        obra_id: obra,
        numero_oc: e.numero,
        oc_item_id: item.id,
        cantidad: e.cantidad,
        rol: e.rol,
        lat: e.lat,
        lng: e.lng,
        precision_m: e.lat == null ? null : 12,
        capturado_en: cuando,
        created_by: e.quien,
        created_at: cuando,
      })
      .select("id")
      .single(),
  );
  for (let k = 0; k < e.fotos; k++) {
    const png = await fotoDemoPng({ grupo: grupoFoto(it.tipo_material, it.rubro), descripcion: it.descripcion, fecha: cuando, variante: k, totalFotos: e.fotos });
    const path = `entregas/${obra}/${e.numero}/demo-${entrega.id}-${k + 1}.png`;
    ok(await db.storage.from("documentos").upload(path, png, { contentType: "image/png", upsert: true }));
    const foto = ok(await db.from("entrega_fotos").insert({ entrega_id: entrega.id, path }).select("id").single());
    ok(await db.from("datos_demo").upsert({ tabla: "entrega_fotos", registro_id: String(foto.id), archivo: path }, { onConflict: "tabla,registro_id" }));
  }
}

// Fotos de los avances de mano de obra de la demo (los registros vienen del seed).
const avances = ok(await db.from("avances").select("id, fecha, partidas(items(descripcion, tipo_material, rubro))").eq("obra_id", obra).order("id"));
for (const a of avances) {
  const it = a.partidas.items;
  const n = a.id % 2 === 0 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const png = await fotoDemoPng({ grupo: grupoFoto(it.tipo_material, it.rubro), descripcion: it.descripcion, fecha: `${a.fecha}T10:00:00`, variante: k, totalFotos: n });
    const path = `avances/${obra}/demo-${a.id}-${k + 1}.png`;
    ok(await db.storage.from("documentos").upload(path, png, { contentType: "image/png", upsert: true }));
    const foto = ok(await db.from("avance_fotos").insert({ avance_id: a.id, path }).select("id").single());
    ok(await db.from("datos_demo").upsert({ tabla: "avance_fotos", registro_id: String(foto.id), archivo: path }, { onConflict: "tabla,registro_id" }));
  }
}
console.log(`Entregas de la demo: ${ENTREGAS.length}; avances con fotos: ${avances.length} (obra ${obra})`);
