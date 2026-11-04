import { Layers } from "lucide-react";
import { logoEmpresa } from "@/lib/empresas";

/** Logo de la empresa (o su inicial, si no tiene logo propio). */
export function LogoEmpresa({ nombre, className }: { nombre: string; className?: string }) {
  const logo = logoEmpresa(nombre);
  return logo ? (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-field bg-white p-1 ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo estático de public/ */}
      <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-field bg-sunken text-2xl font-bold text-ink-2 ${className ?? ""}`}>
      {nombre.trim().charAt(0)}
    </span>
  );
}

/** «Todas las empresas». */
export function IconoTodas({ className }: { className?: string }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-field bg-sunken text-ink-2 ${className ?? ""}`}>
      <Layers size={22} />
    </span>
  );
}
