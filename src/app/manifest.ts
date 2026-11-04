import type { MetadataRoute } from "next";
import { APP_CORTO, APP_DESCRIPCION, APP_NOMBRE, COLOR_FONDO } from "@/lib/marca";

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
    theme_color: COLOR_FONDO,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/icono/192", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icono/512", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icono/512-maskable", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
