"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/format";

/**
 * Imagen de un archivo guardado (URL firmada, que vence a la hora). Si no carga —la página quedó abierta más de una
 * hora y el enlace venció—, pide la pantalla de nuevo una vez (trae enlaces nuevos); si aun así falla, lo dice con un
 * botón que recarga la página, en vez de la imagen rota.
 */
export function ImagenFirmada({ src, alt, className, loading = "lazy" }: { src: string; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  const router = useRouter();
  const [fallida, setFallida] = useState<string | null>(null);
  const [refrescada, setRefrescada] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const falla = () => {
    setFallida(src);
    if (!refrescada) {
      setRefrescada(true);
      router.refresh();
    }
  };
  // Si falló antes de que React tomara la página (al abrirla), el evento se perdió: se revisa al montar.
  useEffect(() => {
    const i = img.current;
    if (i && i.complete && i.naturalWidth === 0 && i.currentSrc) falla();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar cada imagen
  }, [src]);

  if (fallida === src) {
    return (
      <span role="alert" className={cn("flex min-h-12 items-center justify-between gap-2 rounded-field border border-dashed border-line px-3 text-[15px] text-ink-3", className)}>
        <span className="min-w-0 truncate">No se pudo cargar {alt}</span>
        <button
          type="button"
          onClick={(e) => {
            // La página entera, de nuevo: siempre trae enlaces nuevos.
            e.stopPropagation();
            window.location.reload();
          }}
          className="flex h-10 shrink-0 items-center gap-1 rounded-control px-2 font-semibold text-primary active:bg-ink/8"
        >
          <RotateCcw size={16} /> Reintentar
        </button>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL firmada de storage (o imagen generada por la app)
    <img
      ref={img}
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      onError={falla}
    />
  );
}
