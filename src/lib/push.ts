import "server-only";
import { createClient as createAdmin } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Database } from "@/lib/database.types";

// Envío de los avisos como notificación push. Los avisos se crean en la base (función notificar);
// después de cada acción que puede generarlos, la app llama a enviarAvisosPendientes() con after().
// Usa la clave secreta de Supabase: lee avisos y suscripciones de todos los usuarios.

const listo =
  !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY && !!process.env.SUPABASE_SECRET_KEY;

if (listo) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:erp@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

const admin = () =>
  createAdmin<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export async function enviarAvisosPendientes() {
  if (!listo) return;
  const db = admin();
  const desde = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: avisos } = await db
    .from("notificaciones")
    .select("id, user_id, titulo, cuerpo, href")
    .is("push_enviado_at", null)
    // Solo los que el usuario quiere también en el celular (sus preferencias de avisos).
    .eq("push", true)
    .gte("created_at", desde)
    .order("id")
    .limit(200);
  if (!avisos?.length) return;

  // Se marcan antes de enviar: si dos acciones coinciden, cada aviso sale una sola vez.
  const ids = avisos.map((a) => a.id);
  await db.from("notificaciones").update({ push_enviado_at: new Date().toISOString() }).in("id", ids).is("push_enviado_at", null);

  const usuarios = [...new Set(avisos.map((a) => a.user_id))];
  const { data: subs } = await db.from("push_suscripciones").select("id, user_id, endpoint, p256dh, auth").in("user_id", usuarios);
  if (!subs?.length) return;

  const vencidas: number[] = [];
  await Promise.all(
    avisos.flatMap((a) =>
      subs
        .filter((s) => s.user_id === a.user_id)
        .map((s) =>
          webpush
            .sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ titulo: a.titulo, cuerpo: a.cuerpo, href: a.href ?? "/avisos", id: a.id }),
              { TTL: 60 * 60 * 24 },
            )
            .catch((e: { statusCode?: number }) => {
              // 404/410: el navegador anuló la suscripción.
              if (e.statusCode === 404 || e.statusCode === 410) vencidas.push(s.id);
            }),
        ),
    ),
  );
  if (vencidas.length) await db.from("push_suscripciones").delete().in("id", vencidas);
}
