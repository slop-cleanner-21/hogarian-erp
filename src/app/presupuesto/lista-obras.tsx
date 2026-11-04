import Link from "next/link";
import { Tabs } from "@/components/list-controls";
import { LogoEmpresa } from "@/components/logo-empresa";
import { soles } from "@/lib/format";
import { todas } from "@/lib/paginar";
import { createClient } from "@/lib/supabase/server";

const cuenta = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Obras con el estado de su presupuesto (Gerencia): cada una en su tarjeta, con el monto del presupuesto. */
export async function ListaObras({ base, tab }: { base: string; tab: "bor" | "pub" }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("obras")
    .select("id, nombre, direccion, presupuesto_estado, empresas(nombre)")
    .eq("presupuesto_estado", tab === "bor" ? "BORRADOR" : "PUBLICADO")
    .order("nombre");
  if (error) throw new Error(error.message);
  // Presupuesto de cada obra: partidas, adicionales y monto (cantidad × P.U.), por páginas (más de 1000 partidas).
  const ids = data.map((o) => o.id);
  const partidas = ids.length
    ? await todas((a, b) => supabase.from("partidas").select("obra_id, requerimiento, cantidad, pu").in("obra_id", ids).order("id").range(a, b))
    : [];
  const resumen = new Map<number, { n: number; adicionales: Set<string>; monto: number }>();
  for (const p of partidas) {
    const r = resumen.get(p.obra_id) ?? { n: 0, adicionales: new Set<string>(), monto: 0 };
    r.n += 1;
    if (p.requerimiento !== "REGULAR") r.adicionales.add(p.requerimiento);
    r.monto += Number(p.cantidad) * Number(p.pu ?? 0);
    resumen.set(p.obra_id, r);
  }

  return (
    <>
      <Tabs
        param="tab"
        current={tab}
        options={[
          { value: "bor", label: "En borrador" },
          { value: "pub", label: "Publicadas" },
        ]}
      />
      <ul className="flex flex-col gap-2">
        {data.map((o) => {
          const r = resumen.get(o.id);
          const empresa = (o.empresas as unknown as { nombre: string } | null)?.nombre;
          return (
            <li key={o.id}>
              <Link href={`${base}/${o.id}`} className="flex flex-col gap-2 rounded-panel bg-surface p-4 active:bg-sunken">
                <span className="flex items-start gap-3">
                  {empresa && <LogoEmpresa nombre={empresa} className="h-10 w-12" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="rotulo text-[20px] font-semibold leading-tight [overflow-wrap:anywhere]">{o.nombre}</span>
                    <span className="text-[14px] text-ink-3">{empresa}</span>
                  </span>
                </span>
                {o.direccion && <span className="text-[14px] leading-snug text-ink-2">{o.direccion}</span>}
                <span className="flex items-end justify-between gap-3 border-t border-line pt-2">
                  <span className="num text-[14px] text-ink-2">
                    {cuenta(r?.n ?? 0, "partida", "partidas")}
                    {(r?.adicionales.size ?? 0) > 0 && <span className="block text-ink-3">{cuenta(r!.adicionales.size, "adicional", "adicionales")}</span>}
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-[13px] text-ink-3">Presupuesto</span>
                    <span className="rotulo text-[24px] font-semibold leading-none">{soles(r?.monto ?? 0)}</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {data.length === 0 && <li className="rounded-panel bg-surface px-4 py-10 text-center text-ink-3">Sin obras</li>}
      </ul>
    </>
  );
}
