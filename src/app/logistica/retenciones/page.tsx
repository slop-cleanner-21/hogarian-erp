import type { Metadata } from "next";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { TODOS, filtro } from "@/lib/filtros";
import { soles } from "@/lib/format";
import { todas } from "@/lib/paginar";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { PestanasProveedores } from "../proveedores/pestanas";
import { ListaRetenciones, type GrupoRetencion } from "./lista";

export const metadata: Metadata = { title: "Retenciones" };

/** Lo retenido por garantía en las OS, por proveedor y obra: lo acumulado y lo que ya se devolvió. */
export default async function RetencionesPage({ searchParams }: PageProps<"/logistica/retenciones">) {
  const sesion = await requireSesion(["LOGISTICA"]);
  const obra = filtro(await searchParams, "obra");
  const supabase = await createClient();
  const filas = await todas((a, b) =>
    supabase.from("v_os_retenidas").select("*").order("obra").order("proveedor").order("obra_id").order("numero").range(a, b),
  );

  const grupos = new Map<string, GrupoRetencion>();
  for (const f of filas) {
    const k = `${f.obra_id}-${f.proveedor_id}`;
    const g =
      grupos.get(k) ??
      ({
        clave: k,
        obraId: f.obra_id!,
        obra: f.obra ?? "",
        cerrada: f.obra_estado === "CERRADA",
        proveedorId: f.proveedor_id!,
        proveedor: f.proveedor ?? "",
        porDevolver: 0,
        sinPagar: 0,
        devuelto: 0,
        ordenes: [],
      } satisfies GrupoRetencion);
    const monto = Number(f.retenido) || 0;
    if (f.retenida_en) g.devuelto += monto;
    else if (f.pagada) g.porDevolver += monto;
    else g.sinPagar += monto;
    g.ordenes.push({ numero: f.numero!, fecha: f.fecha, retenido: monto, pagada: !!f.pagada, retenidaEn: f.retenida_en });
    grupos.set(k, g);
  }
  const todos = [...grupos.values()];
  const obras = [...new Map(todos.map((g) => [g.obraId, g.obra])).entries()];
  const visibles = todos.filter((g) => !obra || String(g.obraId) === obra);

  return (
    <>
      <TopBar title="Retenciones" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-20 pt-3">
        <PestanasProveedores actual="retenciones" />
        <UrlSelect
          param="obra"
          label="Obra"
          value={obra ?? TODOS}
          options={[{ value: TODOS, label: "Todas las obras" }, ...obras.map(([id, nombre]) => ({ value: String(id), label: nombre }))]}
        />
        <dl className="num grid grid-cols-3 gap-2 rounded-panel bg-surface p-3 text-[14px]">
          {(
            [
              ["Por devolver", visibles.reduce((a, g) => a + g.porDevolver, 0)],
              ["Sin pagar", visibles.reduce((a, g) => a + g.sinPagar, 0)],
              ["Devuelto", visibles.reduce((a, g) => a + g.devuelto, 0)],
            ] as const
          ).map(([label, monto]) => (
            <div key={label}>
              <dt className="text-ink-3">{label}</dt>
              <dd className="font-semibold">{soles(monto)}</dd>
            </div>
          ))}
        </dl>
        <ListaRetenciones grupos={visibles} />
      </main>
    </>
  );
}
