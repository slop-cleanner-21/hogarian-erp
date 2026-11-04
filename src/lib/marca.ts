// Identidad de la app (Grupo Hogarian): nombre, colores y la marca vectorial
// (hexágono con "HG"), reconstruida del logo oficial. Fuente única para ícono,
// manifiesto y logo.

export const APP_NOMBRE = "Hogarian ERP";
export const APP_CORTO = "Hogarian";
export const APP_DESCRIPCION = "Órdenes de compra y servicio, contabilidad y tesorería de obras.";

export const COLOR_MARCA = "#0a3e68";
export const COLOR_FONDO = "#e7e9e4";

/** Lienzo de la marca. */
export const MARCA_VIEWBOX = { w: 236, h: 272 } as const;

/** Trazos de la marca: hexágono abierto (con la "G") y la "H". */
export const MARCA_TRAZOS = [
  { d: "M223.5 125 V196.9 L118 257.8 L12.5 196.9 V86", grosor: 25 },
  { d: "M30.4 64.7 L118 14.2 L223.5 75.1 V104", grosor: 25 },
  { d: "M77 87 V192 M152 87 V192 M66 137 H223.5", grosor: 22 },
] as const;

/**
 * SVG cuadrado de 64×64 con la marca centrada sobre fondo blanco.
 * `escala` controla el tamaño de la marca (menor = más margen, p. ej. íconos "maskable").
 */
export function marcaSvg({ escala = 0.19, redondeo = 14 }: { escala?: number; redondeo?: number } = {}) {
  const dx = ((64 - MARCA_VIEWBOX.w * escala) / 2).toFixed(2);
  const dy = ((64 - MARCA_VIEWBOX.h * escala) / 2).toFixed(2);
  const trazos = MARCA_TRAZOS.map((t) => `<path d="${t.d}" stroke-width="${t.grosor}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="${redondeo}" fill="#ffffff"/>` +
    `<g transform="translate(${dx} ${dy}) scale(${escala})" fill="none" stroke="${COLOR_MARCA}" stroke-linejoin="miter">${trazos}</g>` +
    `</svg>`
  );
}
