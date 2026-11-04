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

export function aplicar(t: Theme) {
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

// Tema que se ve (el elegido, o el del sistema): lo usa el botón sol / luna del login.
const efectivo = () =>
  document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";
const subscribeEfectivo = (l: () => void) => {
  const obs = new MutationObserver(l);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", l);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", l);
  };
};

/** Sol / luna: cambia entre claro y oscuro (lo mismo que el selector del menú). */
export function TemaBoton() {
  const tema = useSyncExternalStore(subscribeEfectivo, efectivo, () => "light" as const);
  const oscuro = tema === "dark";
  return (
    <button
      type="button"
      onClick={() => aplicar(oscuro ? "light" : "dark")}
      aria-label={oscuro ? "Modo claro" : "Modo oscuro"}
      className="flex h-12 w-12 items-center justify-center rounded-control text-ink-2 active:bg-ink/8"
    >
      {oscuro ? <Sun size={22} /> : <Moon size={22} />}
    </button>
  );
}
