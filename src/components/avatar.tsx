import { cn } from "@/lib/format";

// Avatar local: iniciales sobre un color fijo por semilla (sin red, sin estado). La semilla es un id,
// así cada persona conserva su color aunque cambie de nombre. Todos dan ≥ 5.9:1 con texto blanco y se
// distinguen del fondo tanto en claro como en oscuro.
const COLORES = ["#2c5d87", "#1e6b52", "#6b4c9a", "#a33a3a", "#8a5a12", "#0f6b6b", "#4a5a6a", "#8b3f6b"];

// FNV-1a de 32 bits: barato y estable entre servidor y cliente.
function hash(texto: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase("es"))
    .join("") || "?";

export function Avatar({ semilla, nombre, size = 40, className }: { semilla: string; nombre: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), backgroundColor: COLORES[hash(semilla) % COLORES.length] }}
      className={cn("flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white", className)}
    >
      {iniciales(nombre)}
    </span>
  );
}
