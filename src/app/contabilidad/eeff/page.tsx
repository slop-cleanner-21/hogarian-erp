import type { Metadata } from "next";
import { Tabs } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { comprobacion, resultados, situacion, type Linea, type Suma } from "@/lib/eeff";
import { cn, soles } from "@/lib/format";
import { periodoLabel, rangoPeriodos } from "@/lib/periodos";
import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Estados financieros" };

const VISTAS = { comp: "Comprobación", sit: "Situación", res: "Resultados" } as const;

/** Último día del mes AAAAMM, como fecha ISO. */
const finDeMes = (p: string) => {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(4, 6)), 0));
  return d.toISOString().slice(0, 10);
};

/**
 * Estados financieros de una empresa, acumulados del ejercicio (desde el 1 de enero) hasta el mes elegido, con los asientos
 * de la app: compras, pagos y pagos de impuestos (src/lib/eeff.ts).
 */
export default async function EeffPage({ searchParams }: PageProps<"/contabilidad/eeff">) {
  const sesion = await requireSesion(ROLES_CONTABILIDAD);
  const sp = await searchParams;
  const vista = (typeof sp.vista === "string" && sp.vista in VISTAS ? sp.vista : "sit") as keyof typeof VISTAS;
  const supabase = await createClient();
  const [{ data: empresas }, { data: conAsientos }] = await Promise.all([
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("asientos").select("empresa_id").order("fecha", { ascending: false }).limit(1),
  ]);
  const empresaId =
    typeof sp.empresa === "string" && (empresas ?? []).some((e) => String(e.id) === sp.empresa)
      ? sp.empresa
      : String(conAsientos?.[0]?.empresa_id ?? empresas?.[0]?.id ?? "");
  const { data: rango } = await supabase.rpc("rango_asientos", { p_empresa_id: Number(empresaId) });
  const desdeR = rango?.[0]?.desde?.replace(/-/g, "").slice(0, 6) ?? null;
  const hastaR = rango?.[0]?.hasta?.replace(/-/g, "").slice(0, 6) ?? null;
  const periodos = rangoPeriodos(desdeR, hastaR);
  const hasta = typeof sp.hasta === "string" && periodos.includes(sp.hasta) ? sp.hasta : (periodos[0] ?? null);

  let sumas: Suma[] = [];
  if (hasta) {
    const { data, error } = await supabase.rpc("sumas_cuentas", {
      p_empresa_id: Number(empresaId),
      p_desde: `${hasta.slice(0, 4)}-01-01`,
      p_hasta: finDeMes(hasta),
    });
    if (error) throw new Error(error.message);
    sumas = (data ?? []).map((s) => ({ cuenta: s.cuenta, denominacion: s.denominacion, debe: Number(s.debe), haber: Number(s.haber) }));
  }

  return (
    <>
      <TopBar title="EEFF" right={<UserMenu id={sesion.userId} nombre={sesion.nombre} rol={sesion.rol} />} />
      <RecordarFiltros clave="contabilidad-eeff" />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-24 pt-3">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <UrlSelect param="empresa" label="Empresa" value={empresaId} options={(empresas ?? []).map((e) => ({ value: String(e.id), label: e.nombre }))} />
          </div>
          <div className="min-w-0 flex-1">
            <UrlSelect
              param="hasta"
              label="Acumulado a"
              value={hasta}
              options={periodos.map((p) => ({ value: p, label: periodoLabel(p) }))}
            />
          </div>
        </div>
        <Tabs param="vista" current={vista} options={Object.entries(VISTAS).map(([value, label]) => ({ value, label }))} />
        {!hasta || sumas.length === 0 ? (
          <p className="px-1 py-10 text-center text-ink-3">Sin asientos</p>
        ) : vista === "comp" ? (
          <Comprobacion sumas={sumas} />
        ) : vista === "sit" ? (
          <Situacion sumas={sumas} />
        ) : (
          <Resultados sumas={sumas} />
        )}
      </main>
    </>
  );
}

function Comprobacion({ sumas }: { sumas: Suma[] }) {
  const { filas, totales, cuadra } = comprobacion(sumas);
  return (
    <>
      <Lista encabezado={[<Pila key="c">{["Cuenta", "Debe · Haber"]}</Pila>, <Pila key="s">{["Saldo", ""]}</Pila>]}>
        {filas.map((f) => (
          <li key={f.cuenta} className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-line px-4 py-2.5 last:border-0">
            <span className="min-w-0">
              <span className="num font-medium">{f.cuenta}</span> <span className="text-ink-2">{f.denominacion ?? ""}</span>
            </span>
            <span className="num whitespace-nowrap text-right font-medium">
              {f.deudor ? soles(f.deudor) : soles(f.acreedor)}
            </span>
            <span className="num text-sm text-ink-3">
              {soles(f.debe)} · {soles(f.haber)}
            </span>
            <span className="text-right text-sm text-ink-3">{f.deudor ? "Deudor" : f.acreedor ? "Acreedor" : "Saldado"}</span>
          </li>
        ))}
      </Lista>
      <section aria-label="Totales" className="num grid grid-cols-2 gap-2 rounded-panel bg-surface p-4 text-right">
        <Total label="Debe" monto={totales.debe} />
        <Total label="Haber" monto={totales.haber} />
        <Total label="Saldos deudores" monto={totales.deudor} />
        <Total label="Saldos acreedores" monto={totales.acreedor} />
      </section>
      {!cuadra && <p role="alert" className="font-semibold text-danger">No cuadra</p>}
    </>
  );
}

function Situacion({ sumas }: { sumas: Suma[] }) {
  const s = situacion(sumas);
  return (
    <>
      <Bloque titulo="Activo" total={s.activo}>
        <Grupo titulo="Corriente" lineas={s.activoCorriente} />
        <Grupo titulo="No corriente" lineas={s.activoNoCorriente} />
      </Bloque>
      <Bloque titulo="Pasivo" total={s.pasivoTotal}>
        <Grupo lineas={s.pasivo} />
      </Bloque>
      <Bloque titulo="Patrimonio" total={s.patrimonioTotal}>
        <Grupo lineas={[...s.patrimonio, { codigo: "", nombre: "Resultado del ejercicio", monto: s.resultado }]} />
      </Bloque>
      <section aria-label="Cuadre" className="num grid grid-cols-2 gap-2 rounded-panel bg-surface p-4 text-right">
        <Total label="Activo" monto={s.activo} />
        <Total label="Pasivo y patrimonio" monto={s.pasivoTotal + s.patrimonioTotal} />
      </section>
      {!s.cuadra && <p role="alert" className="font-semibold text-danger">No cuadra</p>}
    </>
  );
}

function Resultados({ sumas }: { sumas: Suma[] }) {
  const r = resultados(sumas);
  return (
    <>
      <Bloque titulo="Ingresos" total={r.totalIngresos}>
        <Grupo lineas={r.ingresos} />
      </Bloque>
      <Bloque titulo="Gastos por naturaleza" total={r.totalGastos}>
        <Grupo lineas={r.gastos} />
      </Bloque>
      <section aria-label="Resultado" className="flex items-baseline justify-between rounded-panel bg-surface p-4">
        <span className="font-semibold">{r.resultado < 0 ? "Pérdida" : "Utilidad"}</span>
        <span className={cn("rotulo whitespace-nowrap text-[24px] font-semibold", r.resultado < 0 && "text-danger")}>{soles(r.resultado)}</span>
      </section>
      <Bloque titulo="Costos y gastos por función (clase 9)" total={r.totalFuncion}>
        <Grupo lineas={r.funcion} />
      </Bloque>
      {r.sinAmarre !== 0 && (
        <p role="alert" className="font-semibold text-warn">
          Clase 9 sin amarre a la 79: {soles(r.sinAmarre)}
        </p>
      )}
    </>
  );
}

function Bloque({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="overflow-hidden rounded-panel bg-surface">
      <h2 className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <span className="rotulo text-[21px] font-semibold">{titulo}</span>
        <span className="rotulo whitespace-nowrap text-[21px] font-semibold">{soles(total)}</span>
      </h2>
      {children}
    </section>
  );
}

function Grupo({ titulo, lineas }: { titulo?: string; lineas: Linea[] }) {
  if (!lineas.length) return null;
  return (
    <div className="px-4 py-2">
      {titulo && <h3 className="pb-1 text-[14px] font-semibold text-ink-2">{titulo}</h3>}
      <ul className="flex flex-col">
        {lineas.map((l) => (
          <li key={l.codigo || l.nombre} className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5">
            <span className="min-w-0">
              {l.codigo && <span className="num font-medium">{l.codigo} </span>}
              <span className="text-ink-2">{l.nombre}</span>
            </span>
            <span className={cn("num whitespace-nowrap text-right", l.monto < 0 && "text-danger")}>{soles(l.monto)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Total({ label, monto }: { label: string; monto: number }) {
  return (
    <div>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="whitespace-nowrap font-semibold">{soles(monto)}</div>
    </div>
  );
}
