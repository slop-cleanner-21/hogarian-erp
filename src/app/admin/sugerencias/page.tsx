import type { Metadata } from "next";
import Link from "next/link";
import { ImagenFirmada } from "@/components/imagen-firmada";
import { TopBar, UserMenu } from "@/components/shell";
import { EnlaceArchivo } from "@/components/visor";
import { rutaInterna } from "@/lib/ruta-interna";
import { createAdminClient } from "@/lib/supabase/admin";
import { urlPublica } from "@/lib/supabase/config";
import { requireSesionVigente } from "@/lib/supabase/server";
import { TIPOS_SUGERENCIA } from "@/lib/sugerencias";
import type { Rol } from "@/lib/types";
import { ROL_LABEL } from "@/lib/usuarios";

export const metadata: Metadata = { title: "Sugerencias" };

const cuando = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });
const TONO: Record<string, string> = { ERROR: "bg-danger-bg text-danger", MEJORA: "bg-sunken text-ink-2", DISENO: "bg-sunken text-ink-2" };

/** Sugerencias (solo el Admin): lo que manda cada usuario desde el encabezado, con su pantalla y sus capturas. */
export default async function SugerenciasPage() {
  const sesion = await requireSesionVigente(["ADMIN"]);
  const db = createAdminClient();
  const { data: sugerencias, error } = await db
    .from("sugerencias")
    .select("id, user_id, rol, tipo, texto, pantalla, ruta, capturas, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const usuarios = [...new Set(sugerencias.flatMap((s) => (s.user_id ? [s.user_id] : [])))];
  const rutas = sugerencias.flatMap((s) => s.capturas);
  const [{ data: perfiles }, { data: firmadas }] = await Promise.all([
    usuarios.length ? db.from("perfiles").select("user_id, nombre").in("user_id", usuarios) : Promise.resolve({ data: [] }),
    rutas.length ? db.storage.from("sugerencias").createSignedUrls(rutas, 3600) : Promise.resolve({ data: [] }),
  ]);
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id, p.nombre]));
  const url = new Map((firmadas ?? []).flatMap((f) => (f.path && f.signedUrl ? [[f.path, urlPublica(f.signedUrl)] as const] : [])));

  return (
    <>
      <TopBar title="Sugerencias" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        {sugerencias.length === 0 && <p className="py-10 text-center text-ink-3">Sin sugerencias</p>}
        <ul className="flex flex-col gap-3">
          {sugerencias.map((s) => {
            const ruta = s.ruta ? rutaInterna(s.ruta) : null;
            return (
              <li key={s.id} className="flex flex-col gap-2 rounded-panel bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{(s.user_id && nombre.get(s.user_id)) || "Usuario eliminado"}</p>
                    <p className="text-[14px] text-ink-3">
                      {ROL_LABEL[s.rol as Rol] ?? s.rol} · {cuando.format(new Date(s.created_at))}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 text-[13px] font-semibold leading-6 ${TONO[s.tipo] ?? ""}`}>
                    {TIPOS_SUGERENCIA.find((t) => t.valor === s.tipo)?.label ?? s.tipo}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words leading-snug">{s.texto}</p>
                {s.capturas.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {s.capturas.map((c, i) => {
                      const href = url.get(c);
                      return href ? (
                        <EnlaceArchivo key={c} href={href} nombre={`Captura ${i + 1}.png`} aria-label={`Ver captura ${i + 1}`} className="block overflow-hidden rounded-field border border-line">
                          <ImagenFirmada src={href} alt={`captura ${i + 1}`} className="h-24 w-full object-cover" />
                        </EnlaceArchivo>
                      ) : null;
                    })}
                  </div>
                )}
                {s.pantalla && (
                  ruta && ruta !== "/" ? (
                    <Link href={ruta} prefetch={false} className="flex min-h-11 items-center truncate text-[15px] font-semibold text-primary">
                      {s.pantalla}
                    </Link>
                  ) : (
                    <p className="truncate text-[15px] text-ink-2">{s.pantalla}</p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
