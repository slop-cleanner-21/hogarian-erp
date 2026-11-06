"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { useCierreFuera } from "./cierre-fuera";

/** Hoja inferior modal (pantalla completa en móvil si `full`). */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Solo si el toque empieza y termina en el fondo (apretar dentro y soltar fuera no la cierra).
  const fuera = useCierreFuera(onClose);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal enfoca el primer botón ("Cerrar"): si la hoja tiene un campo principal, va ahí.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // "close" de un <dialog> hijo (selector anidado) se propaga por React: ignorarlo.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      {...fuera}
      className={cn(
        "m-0 mt-auto w-full max-w-none bg-transparent p-0 sm:m-auto sm:max-w-lg",
        full ? "h-dvh max-h-dvh sm:h-[80dvh]" : "max-h-[90dvh]",
      )}
    >
      <div
        className={cn(
          "flex flex-col bg-surface sm:rounded-panel",
          full ? "h-full" : "max-h-[90dvh] rounded-t-[16px]",
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pl-4 pr-1">
          <h2 className="rotulo flex-1 truncate text-[22px] font-semibold leading-[1.2]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
          >
            <X size={22} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {/* El margen del iPhone se suma al relleno (con «pb-safe» lo reemplazaba y el botón quedaba pegado abajo). */}
        {footer && <footer className="shrink-0 border-t border-line px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </dialog>
  );
}
