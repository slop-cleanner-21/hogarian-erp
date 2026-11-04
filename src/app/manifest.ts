import type { MetadataRoute } from "next";
import { APP_CORTO, APP_DESCRIPCION, APP_NOMBRE, COLOR_FONDO } from "@/lib/marca";
import { COLOR_BARRA } from "@/lib/theme";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NOMBRE,
    short_name: APP_CORTO,
    description: APP_DESCRIPCION,
    lang: "es-PE",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: COLOR_FONDO,
    // La barra de navegación de Android (atrás, inicio, tareas) en la app instalada toma este color y no sigue el
    // tema de la página (la de arriba sí, con meta theme-color): oscura, con íconos blancos, en los dos temas.
    theme_color: COLOR_BARRA.dark,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icono/192", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icono/512", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icono/512-maskable", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
