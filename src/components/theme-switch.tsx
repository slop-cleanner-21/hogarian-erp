"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/format";
import { THEME_KEY, type Theme } from "@/lib/theme";

const OPCIONES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

const listeners = new Set<() => void>();

function leer(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function aplicar(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // Sin almacenamiento: el tema aplica solo a esta vista.
  }
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ThemeSwitch() {
  const tema = useSyncExternalStore(subscribe, leer, () => "system" as Theme);
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-control bg-sunken p-1">
      {OPCIONES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={tema === value}
          onClick={() => aplicar(value)}
          className={cn(
            "flex h-11 items-center justify-center gap-1.5 rounded-field text-[15px]",
            tema === value ? "bg-surface font-semibold text-ink" : "text-ink-2",
          )}
        >
          <Icon size={17} strokeWidth={tema === value ? 2.2 : 1.8} />
          {label}
        </button>
      ))}
    </div>
  );
}
