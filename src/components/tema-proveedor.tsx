"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_KEY_PROVEEDOR } from "@/lib/theme";

const subscribe = (l: () => void) => {
  const obs = new MutationObserver(l);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
};
const oscuro = () => document.documentElement.dataset.theme === "dark";

/** Sol / luna del proveedor: su vista es clara por defecto, sin importar el dispositivo. */
export function TemaProveedor() {
  const esOscuro = useSyncExternalStore(subscribe, oscuro, () => false);
  const cambiar = () => {
    const t = esOscuro ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY_PROVEEDOR, t);
    } catch {
      // Sin almacenamiento: aplica solo a esta vista.
    }
  };
  return (
    <button
      type="button"
      onClick={cambiar}
      aria-label={esOscuro ? "Modo claro" : "Modo oscuro"}
      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-3 active:bg-ink/8"
    >
      {esOscuro ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
