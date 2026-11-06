import { CircleAlert } from "lucide-react";

/** Junto al botón de enviar: por qué aún no se puede. Sin nada pendiente, no se muestra. */
export function Faltan({ items }: { items: (string | false | null | undefined)[] }) {
  const pendientes = items.filter(Boolean);
  if (!pendientes.length) return null;
  return (
    <p role="status" aria-label="Lo que falta" className="flex items-start gap-2 rounded-field bg-warn-bg px-3 py-2 text-[15px] font-medium leading-snug text-warn">
      <CircleAlert size={18} className="mt-0.5 shrink-0" />
      <span>Falta: {pendientes.join(", ")}</span>
    </p>
  );
}
