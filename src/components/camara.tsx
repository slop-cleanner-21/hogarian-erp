"use client";

import { Camera, Check, Flashlight, FlashlightOff, RefreshCw, SwitchCamera, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { Button } from "./ui/button";
import { useVisor } from "./visor";

/**
 * Fotos tomadas con la cámara integrada en la app: no se abre la aplicación de cámara del
 * teléfono ni la galería, así no se pueden subir fotos de otro momento. En el formulario se ven
 * las miniaturas; la cámara se abre a pantalla completa.
 */
export function Camara({ fotos, onChange }: { fotos: File[]; onChange: (fotos: File[]) => void }) {
  const [abierta, setAbierta] = useState(false);
  const visor = useVisor();
  // Vistas previas de las fotos tomadas (URL locales que se liberan al cambiar la lista).
  const vistas = useMemo(() => fotos.map((f) => ({ f, url: URL.createObjectURL(f) })), [fotos]);
  useEffect(() => () => vistas.forEach((v) => URL.revokeObjectURL(v.url)), [vistas]);

  return (
    <div className="flex flex-col gap-3">
      {vistas.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {vistas.map(({ f, url }, i) => (
            <li key={url} className="relative">
              <button type="button" onClick={() => visor.abrir(vistas.map((v) => v.url), i)} aria-label={`Ver foto ${i + 1}`} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob) */}
                <img src={url} alt={`Foto ${i + 1}`} className="aspect-square w-full rounded-field object-cover" />
              </button>
              <button
                type="button"
                aria-label={`Quitar foto ${i + 1}`}
                onClick={() => onChange(fotos.filter((x) => x !== f))}
                className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end p-1.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
                  <X size={15} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant={fotos.length ? "secondary" : "primary"} onClick={() => setAbierta(true)} className="h-14 text-[17px]">
        <Camera size={22} /> {fotos.length ? "Tomar más fotos" : "Tomar fotos"}
      </Button>
      {visor.elemento}
      {abierta && <CamaraCompleta fotos={fotos} onChange={onChange} onClose={() => setAbierta(false)} />}
    </div>
  );
}

type Linterna = { track: MediaStreamTrack; encendida: boolean } | null;

function CamaraCompleta({ fotos, onChange, onClose }: { fotos: File[]; onChange: (fotos: File[]) => void; onClose: () => void }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [frontal, setFrontal] = useState(false);
  const [varias, setVarias] = useState(false);
  const [lista, setLista] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linterna, setLinterna] = useState<Linterna>(null);
  const [destello, setDestello] = useState(false);
  const [intento, setIntento] = useState(0);
  // La última foto se muestra junto al obturador para confirmar que se tomó.
  const ultima = useMemo(() => (fotos.length ? URL.createObjectURL(fotos[fotos.length - 1]) : null), [fotos]);
  useEffect(() => () => void (ultima && URL.revokeObjectURL(ultima)), [ultima]);

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  const detener = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let cancelado = false;
    queueMicrotask(() => {
      setLista(false);
      setError(null);
    });
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setError("Este navegador no permite usar la cámara"));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: frontal ? "user" : "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelado) return s.getTracks().forEach((t) => t.stop());
        detener();
        stream.current = s;
        if (video.current) video.current.srcObject = s;
        const track = s.getVideoTracks()[0];
        const capacidades = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setLinterna(capacidades.torch ? { track, encendida: false } : null);
        const dispositivos = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setVarias(dispositivos.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch(() => setError("Permite el acceso a la cámara para tomar las fotos"));
    return () => {
      cancelado = true;
      detener();
    };
  }, [frontal, intento, detener]);

  const capturar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setDestello(true);
    setTimeout(() => setDestello(false), 120);
    navigator.vibrate?.(30);
    canvas.toBlob(
      (b) => {
        if (b) onChange([...fotos, new File([b], `foto-${Date.now()}.jpg`, { type: "image/jpeg" })]);
      },
      "image/jpeg",
      0.85,
    );
  };

  const alternarLinterna = async () => {
    if (!linterna) return;
    const encendida = !linterna.encendida;
    await linterna.track.applyConstraints({ advanced: [{ torch: encendida } as MediaTrackConstraintSet] }).catch(() => {});
    setLinterna({ ...linterna, encendida });
  };

  const cerrar = () => {
    detener();
    onClose();
  };

  return (
    <dialog
      ref={dialogo}
      onClose={cerrar}
      aria-label="Cámara"
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="relative flex h-full flex-col">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setLista(true)}
          aria-label="Vista de la cámara"
          className={cn("absolute inset-0 h-full w-full object-cover", frontal && "-scale-x-100")}
        />
        {destello && <div aria-hidden className="absolute inset-0 bg-white/80" />}

        <header className="relative flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent px-1 pb-6 pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={cerrar} aria-label="Cerrar cámara" className="flex h-12 w-12 items-center justify-center rounded-full active:bg-white/15">
            <X size={26} />
          </button>
          <span className="num flex-1 text-center text-[16px] font-semibold">
            {fotos.length ? `${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}` : ""}
          </span>
          {linterna && (
            <button
              type="button"
              onClick={alternarLinterna}
              aria-label={linterna.encendida ? "Apagar linterna" : "Encender linterna"}
              aria-pressed={linterna.encendida}
              className="flex h-12 w-12 items-center justify-center rounded-full active:bg-white/15"
            >
              {linterna.encendida ? <Flashlight size={22} /> : <FlashlightOff size={22} />}
            </button>
          )}
          {varias && (
            <button type="button" onClick={() => setFrontal((f) => !f)} aria-label="Cambiar de cámara" className="flex h-12 w-12 items-center justify-center rounded-full active:bg-white/15">
              <SwitchCamera size={22} />
            </button>
          )}
        </header>

        {error && (
          <div role="alert" className="relative mx-6 mt-auto flex flex-col items-center gap-3 rounded-panel bg-black/70 p-5 text-center">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => setIntento((n) => n + 1)}>
              <RefreshCw size={18} /> Reintentar
            </Button>
          </div>
        )}

        <footer className="relative mt-auto grid grid-cols-3 items-center bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
          <span className="justify-self-start">
            {ultima && (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob)
              <img src={ultima} alt="Última foto" className="h-14 w-14 rounded-field border-2 border-white object-cover" />
            )}
          </span>
          <button
            type="button"
            onClick={capturar}
            disabled={!lista || !!error}
            aria-label="Tomar foto"
            className="flex h-20 w-20 items-center justify-center justify-self-center rounded-full border-[5px] border-white active:scale-95 disabled:opacity-40"
          >
            <span className="h-[62px] w-[62px] rounded-full bg-white" />
          </button>
          <button
            type="button"
            onClick={cerrar}
            disabled={!fotos.length}
            className="flex h-12 items-center gap-1.5 justify-self-end rounded-full bg-white px-4 font-semibold text-black active:opacity-80 disabled:opacity-0"
          >
            <Check size={18} /> Listo
          </button>
        </footer>
      </div>
    </dialog>
  );
}
