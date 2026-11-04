import type { Metadata } from "next";
import Link from "next/link";
import { FiltrosHoja } from "@/components/filtros-hoja";
import { SearchBox, Tabs, VerMas } from "@/components/list-controls";
import { TopBar, UserMenu } from "@/components/shell";
import { ACCION_LABEL, TABLA_LABEL, filtrosDe, reporteAuditoria } from "@/lib/auditoria-reporte";
import { TODOS, limite as limiteDe } from "@/lib/filtros";
import { createClient, requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Auditoría" };

const LIMA = "America/Lima";
const cuando = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: LIMA });

const ACCIONES = {
  sesiones: ["LOGIN", "LOGIN_FALLIDO", "LOGOUT", "CAMBIO_CONTRASENA"],
  cambios: ["INSERT", "UPDATE", "DELETE", "CREAR_USUARIO", "EDITAR_USUARIO", "RESTABLECER_CONTRASENA", "DESACTIVAR", "REACTIVAR"],
};

/**
 * Auditoría (solo el Admin): las sesiones (inicio, intento fallido, cierre y cambio de contraseña, con IP y
 * dispositivo) y cada cambio de la base (quién, cuándo, qué tabla y registro y qué cambió).
 */
export default async function AuditoriaPage({ searchParams }: PageProps<"/admin/auditoria">) {
  const sesion = await requireSesion(["ADMIN"]);
  const sp = await searchParams;
  const f = filtrosDe(sp);
  const limite = limiteDe(sp);
  const supabase = await createClient();
  const [filas, { data: perfiles }] = await Promise.all([
    reporteAuditoria(f, limite),
    supabase.from("perfiles").select("user_id, nombre").order("nombre"),
  ]);
  const csv = `/admin/auditoria/csv?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))}`;

  return (
    <>
      <TopBar title="Auditoría" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <Tabs
          param="vista"
          current={f.vista}
          quitar={["accion", "tabla"]}
          options={[
            { value: "sesiones", label: "Sesiones" },
            { value: "cambios", label: "Cambios" },
          ]}
        />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox placeholder={f.vista === "cambios" ? "Registro (p. ej. 19/100010)" : "Correo"} />
          </div>
          <FiltrosHoja
            secciones={[
              { tipo: "lista", param: "usuario", titulo: "Usuario", opciones: (perfiles ?? []).map((p) => ({ value: p.user_id, label: p.nombre })) },
              { tipo: "fecha", param: "fecha", titulo: "Fecha" },
              {
                tipo: "opciones",
                param: "accion",
                titulo: "Acción",
                opciones: [{ value: TODOS, label: "Todas" }, ...ACCIONES[f.vista].map((a) => ({ value: a, label: ACCION_LABEL[a] }))],
              },
              ...(f.vista === "cambios"
                ? [
                    {
                      tipo: "lista" as const,
                      param: "tabla",
                      titulo: "Qué",
                      opciones: Object.entries(TABLA_LABEL)
                        .filter(([t]) => t !== "sesion")
                        .map(([value, label]) => ({ value, label }))
                        .sort((a, b) => a.label.localeCompare(b.label)),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="num text-[14px] text-ink-3">{filas.length === limite ? `Los ${limite} más recientes` : `${filas.length} registros`}</span>
          <a href={csv} download className="flex h-11 items-center rounded-control px-2 text-[15px] font-semibold text-primary active:bg-ink/8">
            Descargar CSV
          </a>
        </div>

        <ul aria-label="Registro" className="overflow-hidden rounded-panel bg-surface">
          {filas.map((r) => (
            <li key={r.id} className="border-b border-line last:border-0">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-col gap-0.5 px-4 py-3 active:bg-ink/8">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{r.usuario}</span>
                    <span className="num shrink-0 text-[13px] text-ink-3">{cuando.format(new Date(r.fecha))}</span>
                  </span>
                  <span className={r.accion.startsWith("Intento") ? "font-semibold text-danger" : undefined}>
                    {r.accion} · {r.objeto}
                  </span>
                  {r.resumen && <span className="line-clamp-2 text-[14px] text-ink-2 [overflow-wrap:anywhere]">{r.resumen}</span>}
                  {(r.ip || r.dispositivo) && (
                    <span className="num text-[13px] text-ink-3">{[r.dispositivo, r.ip].filter(Boolean).join(" · ")}</span>
                  )}
                </summary>
                <div className="flex flex-col gap-2 px-4 pb-3">
                  {r.href && (
                    <Link prefetch={false} href={r.href} className="text-[15px] font-semibold text-primary">
                      Ver la orden
                    </Link>
                  )}
                  <pre className="max-h-72 overflow-auto rounded-field bg-sunken p-2 text-[12px] leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {JSON.stringify(r.detalle, null, 2)}
                  </pre>
                </div>
              </details>
            </li>
          ))}
          {filas.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin registros</li>}
        </ul>
        <VerMas visibles={filas.length} limite={limite} />
      </main>
    </>
  );
}
