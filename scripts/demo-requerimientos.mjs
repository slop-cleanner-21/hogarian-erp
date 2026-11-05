// Requerimientos de Operaciones de la obra simulada (RESIDENCIAL LOS ÁLAMOS), con las mismas
// funciones y permisos que la app: uno atendido en parte, un adelanto de cemento en cadena
// (L2A toma de L2B y L2B toma de ACB 1) y uno anulado. En DEMO HOGARIAN deja el cemento y el
// acero de L1A casi sin saldo para probar a mano un requerimiento que adelanta de L1B.
//
// Uso (después de db:simular):  npm run db:demo-requerimientos
import { createClient } from "@supabase/supabase-js";

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRETA = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !ANON || !SECRETA) throw new Error("Faltan variables de Supabase en .env.local");
const admin = createClient(URL_SB, SECRETA, { auth: { persistSession: false } });

const ok = (r, ctx) => {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
};
async function como(email) {
  const c = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  // Las contraseñas no están en Supabase Auth (credenciales): la sesión se abre con un enlace mágico de un solo uso.
  const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (e1) throw new Error(`${email}: ${e1.message}`);
  const { error } = await c.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

// DEMO HOGARIAN: L1A casi sin saldo de cemento y acero (pedir más obliga a adelantar de L1B).
const demo = ok(await admin.from("obras").select("id").eq("nombre", "DEMO HOGARIAN").maybeSingle(), "obra demo");
if (demo && !ok(await admin.from("requerimientos_obra").select("id").eq("obra_id", demo.id).limit(1), "requerimientos demo").length) {
  const filasDemo = ok(
    await admin.from("v_seguimiento_partida").select("partida_id, etapa, descripcion, presupuesto_efectivo, requerido").eq("obra_id", demo.id),
    "partidas demo",
  );
  const p = (descripcion) => filasDemo.find((x) => x.descripcion === descripcion && x.etapa === "L1A");
  const [cemento, acero] = [p("CEMENTO TIPO I"), p("ACERO DE 1/2''")];
  if (cemento && acero) {
    const johanDemo = await como("operaciones@erp.local");
    const id = Number(
      ok(
        await johanDemo.rpc("crear_requerimiento", {
          p_obra_id: demo.id,
          p_nota: "Columnas y vigas del 1er piso",
          p_lineas: [
            { partida_id: cemento.partida_id, cantidad: Number(cemento.presupuesto_efectivo) - 30, adelantos: [] },
            { partida_id: acero.partida_id, cantidad: Number(acero.presupuesto_efectivo) - 20, adelantos: [] },
          ],
        }),
        "requerimiento demo",
      ),
    );
    ok(await admin.from("requerimientos_obra").update({ created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq("id", id), "fecha demo");
    console.log("DEMO HOGARIAN: L1A queda con 30 BLS de cemento y 20 de acero de 1/2 por requerir.");
  }
}

const obra = ok(await admin.from("obras").select("id").eq("nombre", "RESIDENCIAL LOS ÁLAMOS").maybeSingle(), "obra");
if (!obra) throw new Error("Falta la obra simulada: corre antes npm run db:simular");
const ya = ok(await admin.from("requerimientos_obra").select("id").eq("obra_id", obra.id).limit(1), "requerimientos");
if (ya.length) {
  console.log("La obra ya tiene requerimientos: no se hace nada.");
  process.exit(0);
}
const [johan, ruben] = await Promise.all([como("operaciones@erp.local"), como("jefeoperaciones@erp.local")]);

// Partidas de la obra con lo que se puede requerir y prestar.
const filas = ok(
  await admin
    .from("v_seguimiento_partida")
    .select("partida_id, etapa, descripcion, grupo, presupuesto_efectivo, requerido, en_logistica, en_tesoreria, por_recibir, recibido")
    .eq("obra_id", obra.id),
  "partidas",
);
const partida = (descripcion, etapa) => {
  const f = filas.find((x) => x.descripcion === descripcion && x.etapa === etapa);
  if (!f) throw new Error(`No está la partida ${descripcion} en ${etapa}`);
  return { ...f, disponible: Number(f.presupuesto_efectivo) - Number(f.requerido) };
};
const r2 = (n) => Math.floor(n * 100) / 100;
const crear = async (c, nota, lineas) => Number(ok(await c.rpc("crear_requerimiento", { p_obra_id: obra.id, p_nota: nota, p_lineas: lineas }), nota));
const fechar = async (id, diasAtras) =>
  ok(await admin.from("requerimientos_obra").update({ created_at: new Date(Date.now() - diasAtras * 86_400_000).toISOString() }).eq("id", id), "fecha");

// 1) Atendido en parte: cemento de L3B (ya comprado) y el tarrajeo de ACB 1 (sin órdenes).
const cementoL3B = partida("CEMENTO TIPO I", "L3B");
const tarrajeo = filas.find((x) => x.etapa === "ACB 1" && x.grupo === "SUBCONTRATOS");
const req1 = await crear(johan, "Para vaciar la losa del 3er piso y empezar acabados", [
  { partida_id: cementoL3B.partida_id, cantidad: r2(cementoL3B.disponible * 0.6), adelantos: [] },
  ...(tarrajeo ? [{ partida_id: tarrajeo.partida_id, cantidad: r2(Number(tarrajeo.presupuesto_efectivo) * 0.5), adelantos: [] }] : []),
]);
await fechar(req1, 12);

// 2) Adelanto en cadena del cemento: a L2A le faltan 20 bolsas y las toma de L2B...
const l2a = partida("CEMENTO TIPO I", "L2A");
const l2b = partida("CEMENTO TIPO I", "L2B");
const req2 = await crear(johan, "Faltó cemento en el vaciado de L2A", [
  { partida_id: l2a.partida_id, cantidad: r2(l2a.disponible + 20), adelantos: [{ partida_origen_id: l2b.partida_id, cantidad: 20 }] },
]);
await fechar(req2, 8);
// ...y después L2B, que quedó corta, toma 30 de ACB 1 (la última etapa con cemento).
const l2bDespues = partida("CEMENTO TIPO I", "L2B");
const acb = partida("CEMENTO TIPO I", "ACB 1");
const req3 = await crear(ruben, "L2B quedó corta por el adelanto a L2A", [
  { partida_id: acb.partida_id, cantidad: 10, adelantos: [] },
]);
await fechar(req3, 6);
const disponibleL2B = Number(
  ok(await admin.from("v_seguimiento_partida").select("presupuesto_efectivo, requerido").eq("partida_id", l2bDespues.partida_id).single(), "l2b")
    .presupuesto_efectivo,
) - Number(ok(await admin.from("v_seguimiento_partida").select("requerido").eq("partida_id", l2bDespues.partida_id).single(), "l2b").requerido);
const req4 = await crear(johan, "Cemento para tarrajeo de L2B", [
  { partida_id: l2bDespues.partida_id, cantidad: r2(disponibleL2B + 30), adelantos: [{ partida_origen_id: acb.partida_id, cantidad: 30 }] },
]);
await fechar(req4, 5);

// 3) Uno anulado (se pidió de más).
const acero = partida("ACERO DE 3/8\"", "ACB 1");
const req5 = await crear(johan, "Acero para escaleras", [{ partida_id: acero.partida_id, cantidad: r2(Math.min(acero.disponible, 15)), adelantos: [] }]);
await fechar(req5, 3);
ok(await ruben.rpc("anular_requerimiento", { p_id: req5, p_motivo: "Se pidió de más: el acero de escaleras ya está en obra" }), "anular");

const resumen = ok(
  await admin.from("requerimientos_obra").select("numero, estado, requerimientos_obra_items(count)").eq("obra_id", obra.id).order("numero"),
  "resumen",
);
for (const r of resumen) console.log(`  ${r.numero}  ${r.estado.padEnd(8)}  ${r.requerimientos_obra_items[0].count} partida(s)`);
const { count } = await admin.from("adelantos").select("id", { count: "exact", head: true }).eq("obra_id", obra.id);
console.log(`Adelantos: ${count}`);
