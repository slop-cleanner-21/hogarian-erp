import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Tabs } from "@/components/list-controls";
import { Lista, Pila } from "@/components/lista";
import { RecordarFiltros } from "@/components/recordar-filtros";
import { TopBar, UserMenu } from "@/components/shell";
import { UrlSelect } from "@/components/url-select";
import { comprobacion, resultados, situacion, type Linea, type Suma } from "@/lib/eeff";
import { ButtonLink } from "@/components/ui/button";
import { cn, fecha, hoyISO, soles } from "@/lib/format";
import { periodoLabel, rangoPeriodos } from "@/lib/periodos";
import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { createClient, requireSesion } from "@/lib/supabase/server";
import { AnularAsiento, NuevoAsiento } from "./libros";

export const metadata: Metadata = { title: "Estados financieros" };

const VISTAS = { diario: "Diario", mayor: "Mayor", comp: "Comprobación", sit: "Situación", res: "Resultados" } as const;
const ORIGEN: Record<string, string> = { COMPRA: "Compra", PAGO: "Pago", IMPUESTO: "Impuesto", MANUAL: "Manual" };

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
  // De los asientos y hasta el mes actual (para poder registrar el primero, p. ej. el de apertura).
  const mesActual = hoyISO().slice(0, 7).replace("-", "");
  const desdeR = rango?.[0]?.desde?.replace(/-/g, "").slice(0, 6) ?? mesActual;
  const hastaR = rango?.[0]?.hasta?.replace(/-/g, "").slice(0, 6) ?? mesActual;
  const periodos = rangoPeriodos(desdeR < mesActual ? desdeR : mesActual, hastaR > mesActual ? hastaR : mesActual);
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
        <Tabs param="vista" current={vista} porFila={3} options={Object.entries(VISTAS).map(([value, label]) => ({ value, label }))} />
        {hasta && vista === "diario" ? (
          <Diario empresaId={Number(empresaId)} hasta={hasta} />
        ) : hasta && vista === "mayor" ? (
          <Mayor empresaId={Number(empresaId)} hasta={hasta} cuenta={typeof sp.cuenta === "string" ? sp.cuenta : null} sumas={sumas} />
        ) : !hasta || sumas.length === 0 ? (
          <p className="px-1 py-10 text-center text-ink-3">Sin asientos</p>
        ) : vista === "comp" ? (
          <Comprobacion sumas={sumas} />
        ) : vista === "sit" ? (
          <Situacion sumas={sumas} />
        ) : (
          <Resultados sumas={sumas} />
        )}
      </main>
      {hasta && (vista === "diario" || vista === "mayor") && (
        <NuevoAsiento empresaId={Number(empresaId)} cuentas={await planDeCuentas()} fechaDefecto={hasta === mesActual ? hoyISO() : finDeMes(hasta)} />
      )}
    </>
  );
}

async function planDeCuentas() {
  const { data } = await (await createClient()).from("cuentas_contables").select("codigo, denominacion").order("codigo");
  return data ?? [];
}

type LineaAsiento = { cuenta: string; debe: number; haber: number; glosa: string | null; orden: number | null; amarre: boolean; cuentas_contables: { denominacion: string } | null };

/** Libro diario: los asientos del mes, con sus líneas, numerados por fecha. */
async function Diario({ empresaId, hasta }: { empresaId: number; hasta: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asientos")
    .select("id, fecha, glosa, origen, asiento_lineas(cuenta, debe, haber, glosa, orden, amarre, cuentas_contables!asiento_lineas_cuenta_fkey(denominacion))")
    .eq("empresa_id", empresaId)
    .gte("fecha", `${hasta.slice(0, 4)}-${hasta.slice(4)}-01`)
    .lte("fecha", finDeMes(hasta))
    .order("fecha")
    .order("id")
    .limit(1000);
  if (error) throw new Error(error.message);
  const asientos = data.map((a, i) => {
    const lineas = (a.asiento_lineas as unknown as LineaAsiento[]).sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0));
    return { ...a, n: i + 1, lineas, total: lineas.reduce((t, l) => t + Number(l.debe), 0) };
  });
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-2">
          {asientos.length} {asientos.length === 1 ? "asiento" : "asientos"}
        </span>
        {asientos.length > 0 && (
          <ButtonLink href={`/contabilidad/eeff/diario?empresa=${empresaId}&periodo=${hasta}`} prefetch={false} variant="secondary" aria-label="Descargar el diario (CSV)">
            <Download size={18} /> CSV
          </ButtonLink>
        )}
      </div>
      {asientos.length === 0 && <p className="px-1 py-10 text-center text-ink-3">Sin asientos</p>}
      {asientos.map((a) => (
        <section key={a.id} aria-label={`Asiento ${a.n}`} className="overflow-hidden rounded-panel bg-surface">
          <header className="flex items-start gap-2 border-b border-line px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="num flex flex-wrap gap-x-3 text-sm text-ink-3">
                <span className="font-semibold text-ink">N° {a.n}</span>
                <span>{fecha(a.fecha)}</span>
                <span>{ORIGEN[a.origen] ?? a.origen}</span>
              </div>
              <div className="leading-snug">{a.glosa}</div>
            </div>
            <span className="num shrink-0 whitespace-nowrap pt-0.5 font-semibold">{soles(a.total)}</span>
            {a.origen === "MANUAL" && <AnularAsiento id={a.id} />}
          </header>
          <ul className="px-4 py-1.5">
            {a.lineas.map((l, k) => (
              <li key={k} className={cn("grid grid-cols-[1fr_auto] gap-x-3 py-1 text-[15px]", l.haber > 0 && "pl-4")}>
                <span className="min-w-0">
                  <span className="num font-medium">{l.cuenta}</span> <span className="text-ink-2">{l.cuentas_contables?.denominacion ?? ""}</span>
                </span>
                <span className="num whitespace-nowrap text-right">
                  {Number(l.debe) > 0 ? soles(Number(l.debe)) : <span className="text-ink-2">{soles(Number(l.haber))}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Libro mayor de una cuenta: sus movimientos del ejercicio hasta el mes, con el saldo de cada uno. */
async function Mayor({ empresaId, hasta, cuenta, sumas }: { empresaId: number; hasta: string; cuenta: string | null; sumas: Suma[] }) {
  const elegida = cuenta && sumas.some((s) => s.cuenta === cuenta) ? cuenta : (sumas[0]?.cuenta ?? null);
  const opciones = sumas.map((s) => ({ value: s.cuenta, label: `${s.cuenta} ${s.denominacion ?? ""}`.trim() }));
  let movimientos: { fecha: string; glosa: string; debe: number; haber: number; saldo: number }[] = [];
  if (elegida) {
    const { data, error } = await (await createClient())
      .from("asiento_lineas")
      .select("debe, haber, glosa, asientos!inner(fecha, glosa, empresa_id)")
      .eq("cuenta", elegida)
      .eq("asientos.empresa_id", empresaId)
      .gte("asientos.fecha", `${hasta.slice(0, 4)}-01-01`)
      .lte("asientos.fecha", finDeMes(hasta))
      .limit(5000);
    if (error) throw new Error(error.message);
    type M = { debe: number; haber: number; glosa: string | null; asientos: { fecha: string; glosa: string } };
    let saldo = 0;
    movimientos = (data as unknown as M[])
      .sort((x, y) => x.asientos.fecha.localeCompare(y.asientos.fecha))
      .map((m) => {
        saldo = Math.round((saldo + Number(m.debe) - Number(m.haber)) * 100) / 100;
        return { fecha: m.asientos.fecha, glosa: m.glosa || m.asientos.glosa, debe: Number(m.debe), haber: Number(m.haber), saldo };
      });
  }
  return (
    <>
      <UrlSelect param="cuenta" label="Cuenta" value={elegida} options={opciones} />
      {movimientos.length === 0 ? (
        <p className="px-1 py-10 text-center text-ink-3">Sin movimientos</p>
      ) : (
        <Lista encabezado={[<Pila key="m">{["Fecha y glosa", "Debe · Haber"]}</Pila>, "Saldo"]}>
          {movimientos.map((m, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-line px-4 py-2.5 last:border-0">
              <span className="min-w-0">
                <span className="num text-sm text-ink-3">{fecha(m.fecha)}</span> <span className="leading-snug">{m.glosa}</span>
              </span>
              <span className={cn("num whitespace-nowrap text-right font-medium", m.saldo < 0 && "text-danger")}>{soles(m.saldo)}</span>
              <span className="num text-sm text-ink-3">
                {m.debe ? soles(m.debe) : "—"} · {m.haber ? soles(m.haber) : "—"}
              </span>
            </li>
          ))}
        </Lista>
      )}
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
