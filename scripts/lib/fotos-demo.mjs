// Fotos DEMO de entregas (obras de prueba): ilustración plana del grupo de materiales o servicios
// con una franja inferior (ítem, número de foto y fecha) y un sello discreto «FOTO DEMO». Como en
// una foto real, no lleva la cantidad: esa la muestra la app una vez por entrega (si la foto la
// repitiera, dos fotos de la misma entrega parecerían dos entregas). Se entrega como PNG: el
// bucket `documentos` no acepta SVG.
import { createRequire } from "node:module";
import { ilustracionSvg } from "./ilustraciones.mjs";

export { grupoFoto } from "./ilustraciones.mjs";

const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/dist/compiled/@vercel/og/index.node.js");
const React = require("react");
const h = React.createElement;

const ANCHO = 800;
const ALTO = 600;

const fechaCorta = (f) => {
  const d = f instanceof Date ? f : new Date(f);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Lima" });
};

const recortar = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** PNG 800×600 de una foto demo de entrega; `variante` es el índice de la foto en su entrega. */
export async function fotoDemoPng({ grupo, descripcion, fecha, variante = 0, totalFotos = 1 }) {
  const svg = Buffer.from(ilustracionSvg(grupo, variante)).toString("base64");
  const el = h(
    "div",
    { style: { width: ANCHO, height: ALTO, display: "flex", position: "relative", fontFamily: "sans-serif" } },
    h("img", { src: `data:image/svg+xml;base64,${svg}`, width: ANCHO, height: ALTO, style: { position: "absolute", top: 0, left: 0 } }),
    // Franja con el texto dentro de x 100-700: las miniaturas de la app recortan la foto en cuadrado.
    h(
      "div",
      {
        style: {
          position: "absolute", left: 0, bottom: 0, width: ANCHO, display: "flex", flexDirection: "column",
          padding: "14px 120px 16px", background: "rgba(28,34,38,0.8)", color: "white",
        },
      },
      h("div", { style: { display: "flex", fontSize: 24, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" } }, recortar(descripcion, 40)),
      h(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 20, color: "#d5dbe0" } },
        h("div", { style: { display: "flex" } }, (totalFotos > 1 ? `Foto ${variante + 1} de ${totalFotos}  ·  ` : "") + fechaCorta(fecha)),
        h(
          "div",
          { style: { display: "flex", padding: "2px 8px", border: "1.5px solid #9aa5ae", borderRadius: 5, color: "#b9c2c9", fontSize: 13, fontWeight: 700, letterSpacing: 1.5 } },
          "FOTO DEMO",
        ),
      ),
    ),
  );
  const r = new ImageResponse(el, { width: ANCHO, height: ALTO });
  return Buffer.from(await r.arrayBuffer());
}
