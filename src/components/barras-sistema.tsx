"use client";

import { useEffect } from "react";
import { COLOR_BARRA } from "@/lib/theme";

/**
 * Mantiene el color de las barras del sistema (estado arriba, navegación abajo en Android)
 * igual al fondo del tema efectivo: el elegido en la app o, si no hay, el del dispositivo.
 */
export function BarrasSistema() {
  useEffect(() => {
    const raiz = document.documentElement;
    const oscuroSistema = matchMedia("(prefers-color-scheme: dark)");

    const sincronizar = () => {
      const tema = raiz.dataset.theme ?? (oscuroSistema.matches ? "dark" : "light");
      const color = tema === "dark" ? COLOR_BARRA.dark : COLOR_BARRA.light;
      const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
      // Las metas con `media` siguen al sistema; con un tema elegido se fijan las dos al mismo color.
      metas.forEach((m) => m.setAttribute("content", color));
    };

    sincronizar();
    const obs = new MutationObserver(sincronizar);
    obs.observe(raiz, { attributes: true, attributeFilter: ["data-theme"] });
    // Al navegar, Next vuelve a poner las metas con su `media` original.
    const obsHead = new MutationObserver(sincronizar);
    obsHead.observe(document.head, { childList: true });
    oscuroSistema.addEventListener("change", sincronizar);
    return () => {
      obs.disconnect();
      obsHead.disconnect();
      oscuroSistema.removeEventListener("change", sincronizar);
    };
  }, []);
  return null;
}
