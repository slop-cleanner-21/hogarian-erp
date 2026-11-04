import Link from "next/link";
import { cn } from "@/lib/format";

/** Proveedores y transportistas comparten la sección: dos pestañas que son rutas. */
export function PestanasProveedores({ actual }: { actual: "proveedores" | "transportistas" }) {
  const tabs = [
    { value: "proveedores", label: "Proveedores", href: "/logistica/proveedores" },
    { value: "transportistas", label: "Transportistas", href: "/logistica/transportistas" },
  ] as const;
  return (
    <nav aria-label="Sección" className="grid grid-cols-2 gap-1 rounded-control bg-sunken p-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={actual === t.value ? "page" : undefined}
          className={cn(
            "flex h-11 items-center justify-center rounded-field text-[15px]",
            actual === t.value ? "bg-surface font-semibold text-ink" : "text-ink-2",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
