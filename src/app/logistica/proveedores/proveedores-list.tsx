"use client";

import { Check, FileText, Paperclip, Plus, Send, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Lista, Pila } from "@/components/lista";
import { IconoWhatsApp } from "@/components/iconos";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput, inputClass } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { Sheet } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { cn, hoyISO } from "@/lib/format";
import { suspensionDelAnio } from "@/lib/retencion";
import { TIPO_COMPROBANTE_LABEL, type Proveedor, type TipoComprobante } from "@/lib/types";
import { guardarProveedor } from "../actions";
import { NuevoTipoSheet } from "../nuevo-tipo";

const BANCOS = ["BBVA", "BCP", "INTERBANK", "SCOTIABANK", "BANCO DE LA NACION", "CMAC TRUJILLO", "CMAC HUANCAYO", "EFECTIVO"];

export type Contacto = { nombre: string | null; telefono: string; whatsapp: boolean; telegram: boolean };
/** El proveedor con su cuenta (proveedor_cuentas, que solo leen Logística, Tesorería, Contabilidad y Gerencia). */
export type ProveedorFicha = Proveedor & {
  banco: string | null;
  cuenta_bancaria: string | null;
  contactos: Contacto[];
  tipos: { tipo_material: string }[];
};

export const PROVEEDOR_VACIO: ProveedorFicha = {
  id: 0,
  ruc_o_cod: "",
  razon_social: "",
  comprobante_habitual: "FACTURA",
  comprobante_excel: null,
  retencion_4ta_pct: 8,
  suspension_4ta_fecha: null,
  suspension_4ta_path: null,
  suspension_4ta_operacion: null,
  banco: null,
  cuenta_bancaria: null,
  contactos: [],
  tipos: [],
};

export function ProveedoresList({ proveedores, tiposMaterial }: { proveedores: ProveedorFicha[]; tiposMaterial: string[] }) {
  const [editando, setEditando] = useState<ProveedorFicha | null>(null);
  return (
    <>
      <Lista encabezado={[<span key="i" className="pl-[52px]"><Pila>{["Razón social", "RUC / DNI", "Vende"]}</Pila></span>, "Contacto"]}>
        {proveedores.map((p) => {
          const c = p.contactos[0];
          return (
            <li key={p.id} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => setEditando(p)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-ink/8"
              >
                <Avatar semilla={`proveedor-${p.id}`} nombre={c?.nombre ?? p.razon_social} size={40} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.razon_social}</div>
                  <div className="num text-sm text-ink-3">{p.ruc_o_cod}</div>
                  {p.tipos.length > 0 && (
                    <div className="truncate text-sm text-ink-2">{p.tipos.map((t) => t.tipo_material).join(", ")}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm">
                  {c ? (
                    <>
                      <div className="num">{c.telefono}</div>
                      <div className="mt-1 flex justify-end gap-1.5 text-ink-3">
                        {c.whatsapp && <IconoWhatsApp size={16} aria-label="WhatsApp" />}
                        {c.telegram && <Send size={16} aria-label="Telegram" />}
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
        {proveedores.length === 0 && <li className="px-4 py-10 text-center text-ink-3">Sin resultados</li>}
      </Lista>
      <Button
        aria-label="Nuevo proveedor"
        onClick={() => setEditando(PROVEEDOR_VACIO)}
        className="fixed bottom-20 right-4 z-30 h-14 px-5 text-[17px] shadow-[0_8px_20px_-6px_rgb(0_0_0/0.45)]"
      >
        <Plus size={22} /> Nuevo
      </Button>
      {editando && <ProveedorSheet proveedor={editando} tiposMaterial={tiposMaterial} onClose={() => setEditando(null)} />}
    </>
  );
}

/** Ficha del proveedor (crear o editar). `onGuardado` recibe el proveedor guardado (p. ej. para elegirlo en una orden). */
export function ProveedorSheet({
  proveedor,
  tiposMaterial,
  onClose,
  onGuardado,
}: {
  proveedor: ProveedorFicha;
  tiposMaterial: string[];
  onClose: () => void;
  onGuardado?: (p: { id: number; ruc_o_cod: string; razon_social: string; comprobante_habitual: TipoComprobante | null; suspension_4ta_fecha: string | null; tipos: string[] }) => void;
}) {
  const router = useRouter();
  const [p, setP] = useState(proveedor);
  const [contactos, setContactos] = useState<Contacto[]>(proveedor.contactos);
  const [tipos, setTipos] = useState<Set<string>>(() => new Set(proveedor.tipos.map((t) => t.tipo_material)));
  const [tiposNuevos, setTiposNuevos] = useState<string[]>([]);
  const [creandoTipo, setCreandoTipo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Suspensión de retenciones de 4ta: se registra con la constancia (la nueva se sube al guardar).
  const [suspension, setSuspension] = useState(!!proveedor.suspension_4ta_fecha);
  const [constancia, setConstancia] = useState<File | null>(null);
  const [retencionPct, setRetencionPct] = useState(String(proveedor.retencion_4ta_pct ?? 8));
  // Recibo por honorarios: personas naturales (DNI o RUC 10) o quien lo emite habitualmente.
  const conHonorarios = p.comprobante_habitual === "RXH" || /^(10\d{9}|\d{8})$/.test(p.ruc_o_cod.trim());
  const set = (patch: Partial<ProveedorFicha>) => {
    setError(null);
    setP((prev) => ({ ...prev, ...patch }));
  };
  const setContacto = (i: number, patch: Partial<Contacto>) => {
    setError(null);
    setContactos((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const guardar = () =>
    startTransition(async () => {
      setError(null);
      if (suspension && !constancia && !p.suspension_4ta_path && !p.suspension_4ta_operacion?.trim()) return setError("Sube la constancia o ingresa su N° de operación");
      if (suspension && !p.suspension_4ta_fecha) return setError("Ingresa la fecha de la constancia");
      const supabase = createClient();
      let path = suspension ? p.suspension_4ta_path : null;
      if (suspension && constancia) {
        const ext = constancia.name.split(".").pop()?.toLowerCase() ?? "pdf";
        path = `proveedores/${p.ruc_o_cod.trim()}/suspension-4ta-${Date.now()}.${ext}`;
        const { error: up } = await supabase.storage.from("documentos").upload(path, constancia);
        if (up) return setError(up.message);
      }
      const res = await guardarProveedor({
        id: p.id || null,
        ruc_o_cod: p.ruc_o_cod,
        razon_social: p.razon_social,
        comprobante_habitual: p.comprobante_habitual,
        retencion_4ta_pct: retencionPct === "" ? 8 : Number(retencionPct),
        suspension_4ta_fecha: suspension ? p.suspension_4ta_fecha : null,
        suspension_4ta_path: path,
        suspension_4ta_operacion: suspension ? p.suspension_4ta_operacion?.trim() || null : null,
        banco: p.banco || null,
        cuenta_bancaria: p.cuenta_bancaria || null,
        contactos: contactos.filter((c) => c.telefono.trim()),
        tipos: [...tipos],
      });
      if (!res.ok) {
        if (constancia && path) await supabase.storage.from("documentos").remove([path]);
        return setError(res.error);
      }
      onGuardado?.({
        id: res.data.id,
        suspension_4ta_fecha: res.data.suspension,
        ruc_o_cod: p.ruc_o_cod.trim(),
        razon_social: p.razon_social.trim(),
        comprobante_habitual: p.comprobante_habitual,
        tipos: [...tipos],
      });
      onClose();
      router.refresh();
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={p.id ? "Proveedor" : "Nuevo proveedor"}
      full
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <Button size="lg" onClick={guardar} disabled={pending}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="RUC / DNI">
          <Input value={p.ruc_o_cod} onChange={(e) => set({ ruc_o_cod: e.target.value.trim() })} inputMode="numeric" className="num" />
        </Field>
        <Field label="Razón social">
          <Input value={p.razon_social} onChange={(e) => set({ razon_social: e.target.value })} />
        </Field>

        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-medium text-ink-2">Contactos</h3>
          {contactos.map((c, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-panel border border-line p-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  aria-label="Nombre del contacto"
                  placeholder="Nombre"
                  value={c.nombre ?? ""}
                  onChange={(e) => setContacto(i, { nombre: e.target.value })}
                />
                <button
                  type="button"
                  aria-label="Quitar contacto"
                  onClick={() => setContactos((cs) => cs.filter((_, j) => j !== i))}
                  className="flex h-12 w-12 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
                >
                  <Trash2 size={19} />
                </button>
              </div>
              <Input
                aria-label="Teléfono"
                placeholder="Teléfono"
                type="tel"
                inputMode="tel"
                value={c.telefono}
                onChange={(e) => setContacto(i, { telefono: e.target.value })}
                className="num"
              />
              <div className="grid grid-cols-2 gap-2">
                <Alternar activo={c.whatsapp} onClick={() => setContacto(i, { whatsapp: !c.whatsapp })}>
                  <IconoWhatsApp size={18} /> WhatsApp
                </Alternar>
                <Alternar activo={c.telegram} onClick={() => setContacto(i, { telegram: !c.telegram })}>
                  <Send size={18} /> Telegram
                </Alternar>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setContactos((cs) => [...cs, { nombre: null, telefono: "", whatsapp: true, telegram: false }])}
          >
            <Plus size={18} /> Agregar contacto
          </Button>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-medium text-ink-2">Vende</h3>
          <div className="grid grid-cols-1 gap-2">
            {[...new Set([...tiposMaterial, ...tiposNuevos])].map((t) => (
              <label key={t} className="flex min-h-12 items-center gap-3 rounded-field border border-line px-3">
                <input
                  type="checkbox"
                  checked={tipos.has(t)}
                  onChange={() =>
                    setTipos((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                  className="h-5 w-5"
                />
                {t}
              </label>
            ))}
            <Button variant="secondary" onClick={() => setCreandoTipo(true)}>
              <Plus size={18} /> Nuevo tipo
            </Button>
          </div>
          {creandoTipo && (
            <NuevoTipoSheet
              inicial=""
              onCreado={(codigo) => {
                setTiposNuevos((n) => [...n, codigo]);
                setTipos((prev) => new Set(prev).add(codigo));
              }}
              onClose={() => setCreandoTipo(false)}
            />
          )}
        </section>

        <Field label="Comprobante habitual">
          <SearchSelect
            label="Comprobante habitual"
            value={p.comprobante_habitual}
            onChange={(v) => set({ comprobante_habitual: v as TipoComprobante })}
            options={Object.entries(TIPO_COMPROBANTE_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        {(conHonorarios || suspension) && (
          <section aria-label="Retención de 4ta" className="flex flex-col gap-3 rounded-panel border border-line p-3">
            <Field label="Retención 4ta (%)">
              <NumberInput
                value={retencionPct}
                placeholder="8"
                onChange={(e) => {
                  setError(null);
                  setRetencionPct(e.target.value);
                }}
              />
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>Suspensión de 4ta categoría</span>
              <input
                type="checkbox"
                checked={suspension}
                onChange={(e) => {
                  setError(null);
                  setSuspension(e.target.checked);
                }}
                className="h-6 w-6 shrink-0 accent-primary"
              />
            </label>
            {suspension && (
              <>
                <Field label="Fecha de la constancia">
                  <Input
                    type="date"
                    value={p.suspension_4ta_fecha ?? ""}
                    max={hoyISO()}
                    onChange={(e) => set({ suspension_4ta_fecha: e.target.value || null })}
                  />
                </Field>
                {p.suspension_4ta_fecha && (
                  <p className={cn("num text-[15px]", suspensionDelAnio(p.suspension_4ta_fecha, hoyISO()) ? "text-ok" : "font-semibold text-danger")}>
                    {suspensionDelAnio(p.suspension_4ta_fecha, hoyISO()) ? "Vigente" : "Vencida"} hasta el 31/12/{p.suspension_4ta_fecha.slice(0, 4)}
                  </p>
                )}
                <Field label="N° de operación">
                  <Input
                    value={p.suspension_4ta_operacion ?? ""}
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(e) => set({ suspension_4ta_operacion: e.target.value.replace(/\D/g, "") || null })}
                    className="num"
                  />
                </Field>
                <ArchivoConstancia
                  actual={!constancia ? p.suspension_4ta_path : null}
                  elegido={constancia}
                  onElegir={(f) => {
                    setError(null);
                    setConstancia(f);
                  }}
                />
              </>
            )}
          </section>
        )}
        <Field label="Banco">
          <SearchSelect
            label="Banco"
            value={p.banco}
            onChange={(v) => set({ banco: v })}
            options={[...new Set([...(p.banco ? [p.banco] : []), ...BANCOS])].map((b) => ({ value: b, label: b }))}
          />
        </Field>
        <Field label="Cuenta">
          <Input value={p.cuenta_bancaria ?? ""} onChange={(e) => set({ cuenta_bancaria: e.target.value })} className="num" />
        </Field>
      </div>
    </Sheet>
  );
}

/** Constancia de suspensión: la ya subida (se abre) o la elegida para subir al guardar. */
function ArchivoConstancia({ actual, elegido, onElegir }: { actual: string | null; elegido: File | null; onElegir: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const abrir = async () => {
    const { data } = await createClient().storage.from("documentos").createSignedUrl(actual!, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="flex flex-col gap-2">
      <input ref={ref} type="file" hidden accept="application/pdf,image/*" onChange={(e) => onElegir(e.target.files?.[0] ?? null)} />
      {actual && (
        <button type="button" onClick={abrir} className="flex min-h-12 items-center gap-2 rounded-field border border-line px-3 text-left text-primary active:bg-ink/8">
          <FileText size={18} className="shrink-0" />
          <span className="truncate">Constancia de suspensión</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn(inputClass, "flex items-center gap-2 text-left", elegido ? "text-ink" : "text-ink-3")}
      >
        {elegido ? <Check size={18} className="shrink-0 text-ok" /> : <Paperclip size={18} className="shrink-0" />}
        <span className="truncate">{elegido ? elegido.name : actual ? "Cambiar constancia" : "Subir constancia"}</span>
      </button>
    </div>
  );
}

function Alternar({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={onClick}
      className={cn(
        "flex h-11 items-center justify-center gap-1.5 rounded-control border text-[15px] font-semibold",
        activo ? "border-primary bg-primary text-primary-ink" : "border-line text-ink-2 active:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}
