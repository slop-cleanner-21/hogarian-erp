"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MarcaAdicional } from "@/components/marca-adicional";
import { Plegable } from "@/components/plegable";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { qty, soles } from "@/lib/format";
import { agregarAdicional } from "./actions";
import { Faltan } from "@/components/ui/faltan";

export type PartidaAdicional = { id: number; etapa: string; requerimiento: string; itemId: number; cantidad: number; pu: number | null };
type Linea = { key: number; etapa: string; itemId: string; cantidad: string; pu: string };

/**
 * Adicionales de la obra (Gerencia): los ya agregados, por N°, y «Nuevo adicional» con una o varias
 * partidas. Una partida adicional puede repetir el ítem y la etapa de una regular. Logística las ve al
 * crear la orden, marcadas como adicional.
 */
export function AdicionalesObra({
  obraId,
  partidas,
  items,
  etapas,
  editable,
}: {
  obraId: number;
  partidas: PartidaAdicional[];
  items: { id: number; descripcion: string; unidad: string }[];
  etapas: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [hoja, setHoja] = useState(false);
  const item = new Map(items.map((i) => [i.id, i]));
  const numero = (r: string) => Number(r.replace(/^ADIC /, "")) || 0;
  const grupos = [...new Set(partidas.filter((p) => p.requerimiento !== "REGULAR").map((p) => p.requerimiento))].sort((a, b) => numero(b) - numero(a));

  return (
    <section aria-label="Adicionales" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1 pt-2">
        <h2 className="rotulo text-[21px] font-semibold">Adicionales</h2>
        {editable && (
          <Button variant="secondary" onClick={() => setHoja(true)}>
            <Plus size={18} /> Nuevo adicional
          </Button>
        )}
      </div>
      {grupos.length === 0 && <p className="rounded-panel bg-surface px-4 py-3 text-ink-3">Sin adicionales</p>}
      {grupos.map((g) => {
        const del = partidas.filter((p) => p.requerimiento === g);
        return (
          // Plegados: una obra del Excel puede tener decenas de adicionales.
          <Plegable
            key={g}
            titulo={
              <span className="flex items-center gap-2">
                <MarcaAdicional requerimiento={g} />
                <span className="num text-[14px] font-normal text-ink-3">{del.length} partida(s)</span>
              </span>
            }
            resumen={soles(del.reduce((a, p) => a + p.cantidad * Number(p.pu ?? 0), 0))}
          >
            <ul className="overflow-hidden rounded-field border border-line">
              {del.map((p) => (
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="leading-snug">{item.get(p.itemId)?.descripcion}</span>
                  <span className="num text-right font-semibold">{soles(p.cantidad * Number(p.pu ?? 0))}</span>
                  <span className="text-[14px] text-ink-3">{p.etapa}</span>
                  <span className="num text-right text-[14px] text-ink-3">
                    {qty(p.cantidad)} {item.get(p.itemId)?.unidad} × {soles(p.pu)}
                  </span>
                </li>
              ))}
            </ul>
          </Plegable>
        );
      })}
      {hoja && (
        <NuevoAdicional
          obraId={obraId}
          partidas={partidas}
          items={items}
          etapas={etapas}
          onClose={() => setHoja(false)}
          onGuardado={() => {
            setHoja(false);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function NuevoAdicional({
  obraId,
  partidas,
  items,
  etapas,
  onClose,
  onGuardado,
}: {
  obraId: number;
  partidas: PartidaAdicional[];
  items: { id: number; descripcion: string; unidad: string }[];
  etapas: string[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<Linea[]>([{ key: 1, etapa: etapas[0] ?? "", itemId: "", cantidad: "", pu: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const opcionesItem = items.map((i) => ({ value: String(i.id), label: i.descripcion, hint: i.unidad }));
  const opcionesEtapa = etapas.map((e) => ({ value: e, label: e }));
  // P.U. propuesto: el de la partida del mismo ítem (en la misma etapa si la hay).
  const puDe = (etapa: string, itemId: string) => {
    const mismas = partidas.filter((p) => String(p.itemId) === itemId && p.pu != null);
    const p = mismas.find((x) => x.etapa === etapa) ?? mismas[0];
    return p ? String(p.pu) : "";
  };
  const cambiar = (key: number, cambio: Partial<Linea>) =>
    setLineas((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = { ...l, ...cambio };
        if ((cambio.itemId !== undefined || cambio.etapa !== undefined) && n.itemId && (!l.pu || cambio.itemId !== undefined)) n.pu = puDe(n.etapa, n.itemId);
        return n;
      }),
    );
  const validas = lineas.every((l) => l.etapa && l.itemId && Number(l.cantidad) > 0 && l.pu !== "" && Number(l.pu) >= 0);
  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.pu) || 0), 0);

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      const r = await agregarAdicional(
        obraId,
        lineas.map((l) => ({ etapa: l.etapa, item_id: Number(l.itemId), cantidad: Number(l.cantidad), pu: Number(l.pu) })),
      );
      if (!r.ok) return setError(r.error);
      onGuardado();
    });

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Nuevo adicional"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <Faltan items={[!validas && "etapa, ítem, cantidad y P.U. en cada línea"]} />
          <Button onClick={guardar} disabled={!validas || pending}>
            Guardar adicional · {soles(total)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {lineas.map((l, i) => (
          <section key={l.key} aria-label={`Partida ${i + 1}`} className="flex flex-col gap-3 rounded-panel border border-line p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-2">Partida {i + 1}</h3>
              {lineas.length > 1 && (
                <button
                  type="button"
                  aria-label={`Quitar partida ${i + 1}`}
                  onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}
                  className="flex h-11 w-11 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            <Field label="Ítem">
              <SearchSelect label="Ítem" value={l.itemId || null} onChange={(v) => cambiar(l.key, { itemId: v })} options={opcionesItem} placeholder="Elegir ítem" multilinea />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Etapa">
                <SearchSelect label="Etapa" value={l.etapa} onChange={(v) => cambiar(l.key, { etapa: v })} options={opcionesEtapa} />
              </Field>
              <Field label="Cantidad">
                <NumberInput aria-label={`Cantidad partida ${i + 1}`} value={l.cantidad} onChange={(e) => cambiar(l.key, { cantidad: e.target.value })} />
              </Field>
              <Field label="P.U.">
                <NumberInput aria-label={`P.U. partida ${i + 1}`} value={l.pu} onChange={(e) => cambiar(l.key, { pu: e.target.value })} />
              </Field>
            </div>
          </section>
        ))}
        <Button
          variant="secondary"
          onClick={() => setLineas((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, etapa: ls.at(-1)?.etapa ?? etapas[0] ?? "", itemId: "", cantidad: "", pu: "" }])}
        >
          <Plus size={18} /> Agregar partida
        </Button>
      </div>
    </Sheet>
  );
}
