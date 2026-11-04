"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { useCierreFuera } from "./cierre-fuera";

export function Confirm({
  open,
  title,
  children,
  onYes,
  onNo,
  pending,
  danger,
  disabled,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  onYes: () => void;
  onNo: () => void;
  pending?: boolean;
  danger?: boolean;
  /** Deshabilita «Sí» (p. ej. hasta completar un campo del cuerpo). */
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Tocar el fondo (fuera del contenido, de principio a fin) equivale a «No».
  const fuera = useCierreFuera(() => !pending && onNo());
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={(e) => e.target === e.currentTarget && onNo()}
      {...fuera}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-panel bg-surface p-0"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="rotulo text-[26px] font-semibold leading-tight">{title}</h2>
        {children}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onNo} disabled={pending}>
            No
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onYes} disabled={pending || disabled}>
            Sí
          </Button>
        </div>
      </div>
    </dialog>
  );
}
