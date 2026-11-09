"use client";

import {
  ChevronDown,
  GalleryHorizontal,
  Images,
  ListCollapse,
  MapPin,
  PackageCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { registrarEntrega } from "@/app/entregas/actions";
import type { EntregaFila, LineaEntrega } from "@/lib/entregas";
import { cn, qty } from "@/lib/format";
import { guardar, leer } from "@/lib/recordar";
import { Camara } from "./camara";
import { EntregasPartida } from "./entregas-partida";
import { useVisor } from "./visor";
import { subirArchivos } from "./documentos";
import { Button } from "./ui/button";
import { CampoObservacion, observacionLista } from "./campo-observacion";
import { Field, NumberInput, inputClass } from "./ui/field";
import { SearchSelect } from "./ui/search-select";
import { Sheet } from "./ui/sheet";
import { Faltan } from "./ui/faltan";

type Vista = "carrusel" | "acordeon" | "galeria";
const VISTAS: { value: Vista; label: string; icon: typeof Images }[] = [
  { value: "carrusel", label: "Fotos bajo cada ítem", icon: GalleryHorizontal },
  { value: "acordeon", label: "Fotos al desplegar", icon: ListCollapse },
  { value: "galeria", label: "Galería por ítem", icon: Images },
];

// La vista elegida se recuerda en el dispositivo.
const CLAVE_VISTA = "vista-entregas";
const oyentes = new Set<() => void>();
const leerVista = (): Vista => leer<Vista>(CLAVE_VISTA) ?? "carrusel";
const suscribir = (l: () => void) => {
  oyentes.add(l);
  return () => oyentes.delete(l);
};
const elegirVista = (v: Vista) => {
  guardar(CLAVE_VISTA, v);
  oyentes.forEach((l) => l());
};

const hora = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // 24 h: «p. m.» se escribe distinto según el navegador y no coincidía con el servidor (error #418 de React).
  hourCycle: "h23",
  timeZone: "America/Lima",
});

/**
 * Entregas de una orden: por ítem, lo pedido vs. lo que llegó, con sus fotos.
 * `registrar` habilita el botón para registrar una entrega ("camara": solo la cámara de la app y
 * con GPS obligatorio, para residentes; "archivos": galería o cámara del teléfono).
 */
export function Entregas({
  obraId,
  numero,
  lineas,
  entregas,
  registrar,
  aviso,
}: {
  obraId: number;
  numero: string;
  lineas: LineaEntrega[];
  entregas: EntregaFila[];
  registrar?: "camara" | "archivos";
  /** Encima de «Registrar entrega» (prod 1: quién no puede registrar todavía). */
  aviso?: string;
}) {
  const vista = useSyncExternalStore(
    suscribir,
    leerVista,
    () => "carrusel" as Vista,
  );
  const [abierta, setAbierta] = useState<number | null>(null);
  const [galeria, setGaleria] = useState<LineaEntrega | null>(null);
  const [nueva, setNueva] = useState(false);
  const porLinea = (id: number) => entregas.filter((e) => e.ocItemId === id);
  const pendientes = lineas.filter((l) => l.entregado < l.pedido - 0.0001);

  return (
    <section aria-label="Entregas" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="rotulo text-[21px] font-semibold">Entregas</h2>
        {entregas.some((e) => e.fotos.length > 0) && (
          <div
            role="radiogroup"
            aria-label="Vista de fotos"
            className="flex gap-0.5"
          >
            {VISTAS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={vista === value}
                aria-label={label}
                onClick={() => elegirVista(value)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-control",
                  vista === value ? "text-ink" : "text-ink-3 active:bg-ink/8",
                )}
              >
                <Icon size={19} strokeWidth={vista === value ? 2.3 : 1.7} />
              </button>
            ))}
          </div>
        )}
      </div>

      {registrar && aviso && <p className="px-1 text-[15px] text-ink-2">{aviso}</p>}
      {registrar && pendientes.length > 0 && (
        <Button variant="secondary" onClick={() => setNueva(true)}>
          <PackageCheck size={18} /> Registrar entrega
        </Button>
      )}

      <ul className="overflow-hidden rounded-panel bg-surface">
        {lineas.map((l) => {
          const fotos = porLinea(l.ocItemId).flatMap((e) => e.fotos);
          const completo = l.entregado >= l.pedido - 0.0001;
          const expandible = vista !== "carrusel" && fotos.length > 0;
          const abrir = () =>
            vista === "galeria"
              ? setGaleria(l)
              : setAbierta(abierta === l.ocItemId ? null : l.ocItemId);
          const cabecera = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="leading-snug">{l.descripcion}</span>
                <span
                  className={cn(
                    "num shrink-0 whitespace-nowrap text-[15px]",
                    completo ? "font-semibold text-ok" : "text-ink-2",
                  )}
                >
                  {qty(l.entregado)} / {qty(l.pedido)}{" "}
                  <span className="text-ink-3">{l.unidad}</span>
                </span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"
                aria-hidden
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    completo ? "bg-ok" : "bg-primary",
                  )}
                  style={{
                    width: `${Math.min(100, (l.entregado / l.pedido) * 100)}%`,
                  }}
                />
              </div>
              {expandible && (
                <div className="mt-1.5 flex items-center gap-1 text-sm text-ink-3">
                  <Images size={14} /> {fotos.length}
                  {vista === "acordeon" && (
                    <ChevronDown
                      size={15}
                      className={cn(
                        "transition-transform",
                        abierta === l.ocItemId && "rotate-180",
                      )}
                    />
                  )}
                </div>
              )}
            </>
          );
          return (
            <li key={l.ocItemId} className="border-b border-line last:border-0">
              {expandible ? (
                <button
                  type="button"
                  onClick={abrir}
                  aria-expanded={
                    vista === "acordeon" ? abierta === l.ocItemId : undefined
                  }
                  className="block w-full px-4 py-3 text-left active:bg-ink/8"
                >
                  {cabecera}
                </button>
              ) : (
                <div className="px-4 py-3">{cabecera}</div>
              )}
              {vista === "carrusel" && fotos.length > 0 && (
                <div className="px-4 pb-3">
                  <EntregasPartida
                    entregas={porLinea(l.ocItemId).map((e) => ({ id: e.id, cantidad: e.cantidad, fecha: e.fecha, rol: e.rol, fotos: e.fotos, observacion: e.observacion }))}
                    unidad={l.unidad}
                  />
                </div>
              )}
              {vista === "acordeon" && abierta === l.ocItemId && (
                <div className="px-4 pb-3">
                  <ListaEntregas
                    entregas={porLinea(l.ocItemId)}
                    unidad={l.unidad}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {galeria && (
        <Sheet
          open
          full
          onClose={() => setGaleria(null)}
          title={galeria.descripcion}
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="num text-ink-2">
              {qty(galeria.entregado)} / {qty(galeria.pedido)} {galeria.unidad}
            </p>
            <ListaEntregas
              entregas={porLinea(galeria.ocItemId)}
              unidad={galeria.unidad}
              grande
            />
          </div>
        </Sheet>
      )}
      {nueva && registrar && (
        <NuevaEntrega
          obraId={obraId}
          numero={numero}
          lineas={pendientes}
          modo={registrar}
          onClose={() => setNueva(false)}
        />
      )}
    </section>
  );
}

function ListaEntregas({
  entregas,
  unidad,
  grande,
}: {
  entregas: EntregaFila[];
  unidad: string;
  grande?: boolean;
}) {
  const visor = useVisor();
  // El visor recorre todas las fotos del ítem, no solo las de una entrega.
  const todas = entregas.flatMap((e) => e.fotos);
  return (
    <>
      {visor.elemento}
      <ul className="flex flex-col gap-3">
        {entregas.map((e) => (
          <li key={e.id} className="flex flex-col gap-1.5">
            <p className="num flex flex-wrap items-center gap-x-3 text-[15px]">
              <span className="font-semibold">
                {qty(e.cantidad)} {unidad}
              </span>
              <span className="text-ink-2">
                {hora.format(new Date(e.fecha))}
              </span>
              <span className="text-ink-3">
                {e.rol === "RESIDENTE"
                  ? "Residente"
                  : e.rol === "HISTORICO"
                    ? "Histórico"
                    : "Logística"}
              </span>
              {e.mapa && (
                <a
                  href={e.mapa}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Ver ubicación"
                  className="-my-2 flex h-11 w-11 items-center justify-center text-primary"
                >
                  <MapPin size={16} />
                </a>
              )}
            </p>
            {e.observacion && <p className="rounded-field bg-danger-bg px-3 py-2 text-[15px] text-danger">Observación: {e.observacion}</p>}
            <div
              className={cn(
                "grid gap-2",
                grande ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {e.fotos.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => visor.abrir(todas, todas.indexOf(url))}
                  aria-label={`Ver foto ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage */}
                  <img
                    src={url}
                    alt="Foto de la entrega"
                    loading="lazy"
                    className={cn(
                      "w-full rounded-field object-cover",
                      grande ? "max-h-[70dvh]" : "aspect-square",
                    )}
                  />
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

type Ubicacion = { lat: number; lng: number; precision: number };

function NuevaEntrega({
  obraId,
  numero,
  lineas,
  modo,
  onClose,
}: {
  obraId: number;
  numero: string;
  lineas: LineaEntrega[];
  modo: "camara" | "archivos";
  onClose: () => void;
}) {
  const router = useRouter();
  const [item, setItem] = useState<string | null>(
    lineas.length === 1 ? String(lineas[0].ocItemId) : null,
  );
  const linea = lineas.find((l) => String(l.ocItemId) === item);
  const [cantidad, setCantidad] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [observacion, setObservacion] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const conGps = modo === "camara";
  const saldo = linea ? linea.pedido - linea.entregado : 0;

  // Residente: la ubicación es obligatoria y se toma al abrir.
  const localizar = () => {
    if (!navigator.geolocation) {
      setErrorGps("Este navegador no da la ubicación");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setErrorGps(null);
        setUbicacion({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: p.coords.accuracy,
        });
      },
      () =>
        setErrorGps(
          "Activa la ubicación del teléfono y permite el acceso para registrar la entrega",
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  };
  useEffect(() => {
    if (conGps) queueMicrotask(localizar);
    // Solo al abrir la hoja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listo =
    !!linea &&
    Number(cantidad) > 0 &&
    Number(cantidad) <= saldo + 0.0001 &&
    // Logística puede registrar sin foto; el residente, no.
    (fotos.length > 0 || modo === "archivos") &&
    observacionLista(observacion) &&
    (!conGps || !!ubicacion);

  const guardarEntrega = () =>
    startTransition(async () => {
      setError(null);
      try {
        const subidas = fotos.length ? await subirArchivos(`entregas/${obraId}/${numero}`, fotos) : [];
        const r = await registrarEntrega({
          obraId,
          numero,
          ocItemId: linea!.ocItemId,
          cantidad: Number(cantidad),
          fotos: subidas.map((s) => s.path),
          lat: ubicacion?.lat ?? null,
          lng: ubicacion?.lng ?? null,
          precision: ubicacion?.precision ?? null,
          capturado: new Date().toISOString(),
          observacion: observacion?.trim() || null,
        });
        if (!r.ok) throw new Error(r.error);
        onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar");
      }
    });

  return (
    <Sheet
      open
      full
      onClose={onClose}
      title="Registrar entrega"
      footer={
        <div className="flex flex-col gap-2">
        <Faltan
          items={[
            !linea && "ítem",
            !!linea && !(Number(cantidad) > 0 && Number(cantidad) <= saldo + 0.0001) && "cantidad que llegó",
            modo === "camara" && fotos.length === 0 && "foto",
            !observacionLista(observacion) && "observación",
            conGps && !ubicacion && "ubicación",
          ]}
        />
        <Button size="lg" onClick={guardarEntrega} disabled={!listo || pending}>
          Registrar
        </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Ítem">
          <SearchSelect
            label="Ítem"
            value={item}
            onChange={(v) => {
              setItem(v);
              setCantidad("");
            }}
            options={lineas.map((l) => ({
              value: String(l.ocItemId),
              label: l.descripcion,
              hint: `Faltan ${qty(l.pedido - l.entregado)} ${l.unidad}`,
            }))}
          />
        </Field>
        <Field
          label={
            linea
              ? `Cantidad (faltan ${qty(saldo)} ${linea.unidad})`
              : "Cantidad"
          }
        >
          <NumberInput
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            disabled={!linea}
          />
        </Field>
        {Number(cantidad) > saldo + 0.0001 && (
          <p className="num text-sm text-danger">Máximo {qty(saldo)}</p>
        )}

        {conGps && (
          <div className="flex items-center gap-2 text-[15px]">
            <MapPin
              size={18}
              className={ubicacion ? "text-ok" : "text-ink-3"}
            />
            {ubicacion ? (
              <span className="num text-ink-2">
                Ubicación lista (±{Math.round(ubicacion.precision)} m)
              </span>
            ) : errorGps ? (
              <span className="flex flex-1 items-center justify-between gap-2 text-danger">
                {errorGps}
                <Button
                  variant="secondary"
                  onClick={localizar}
                  className="h-11 shrink-0 px-3"
                >
                  Reintentar
                </Button>
              </span>
            ) : (
              <span className="text-ink-3">Obteniendo ubicación…</span>
            )}
          </div>
        )}

        {modo === "camara" ? (
          <section aria-label="Fotos" className="flex flex-col gap-1.5">
            <h3 className="text-[15px] font-medium text-ink-2">Fotos</h3>
            <Camara fotos={fotos} onChange={setFotos} />
          </section>
        ) : (
          <Field label="Fotos">
            <SelectorFotos fotos={fotos} onChange={setFotos} />
          </Field>
        )}
        <CampoObservacion valor={observacion} onChange={setObservacion} />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function SelectorFotos({
  fotos,
  onChange,
}: {
  fotos: File[];
  onChange: (f: File[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        className={cn(
          inputClass,
          "flex cursor-pointer items-center gap-2 text-ink-3",
        )}
      >
        <Images size={18} className="shrink-0" />
        {fotos.length
          ? `${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}`
          : "Agregar fotos"}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            onChange([...fotos, ...Array.from(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </label>
      {fotos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <button
                type="button"
                onClick={() => onChange(fotos.filter((x) => x !== f))}
                aria-label={`Quitar ${f.name}`}
                className="flex min-h-11 items-center gap-1 rounded-full border border-line px-3 text-sm"
              >
                <span className="max-w-40 truncate">{f.name}</span>
                <span aria-hidden className="text-ink-3">
                  ✕
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
