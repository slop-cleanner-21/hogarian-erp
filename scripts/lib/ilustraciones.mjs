// Ilustraciones demo (SVG, estilo plano, nada realista) para las fotos de entregas de las obras
// de prueba. Una por grupo de materiales o servicios; `variante` cambia el encuadre para que dos
// fotos de la misma entrega no se vean idénticas.

const CIELO = ["#dfe8ee", "#e8e2d6", "#e3e9df"];
const SILUETA = ["#cdd8df", "#d9d1c2", "#d2dacd"];
const PISO = "#b9a98f";
const MADERA = "#8b6b3e";

// Fondo: cielo, sol, edificios lejanos y piso (y = 470 en la imagen final).
const fondo = (v) => {
  const c = v % CIELO.length;
  const edificios = [
    [40, 330, 90], [140, 280, 70], [220, 350, 110], [560, 300, 80], [650, 250, 70], [730, 340, 90],
  ]
    .map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${470 - y}" fill="${SILUETA[c]}"/>`)
    .join("");
  return `
  <rect width="800" height="600" fill="${CIELO[c]}"/>
  <circle cx="${v % 2 ? 610 : 190}" cy="96" r="36" fill="#f6e3a1"/>
  ${edificios}
  <rect y="470" width="800" height="130" fill="${PISO}"/>
  <rect y="470" width="800" height="8" fill="#a8977c"/>`;
};

// Cada dibujo ocupa aprox. x 110-690, y 140-440 (apoyado en el piso, y = 440); se amplía 1,2x.
const DIBUJOS = {
  ACERO: () => {
    const barras = Array.from({ length: 9 }, (_, i) => {
      const y = 300 + i * 12;
      const color = i % 2 ? "#5f6a73" : "#707c86";
      const estrias = Array.from({ length: 36 }, (_, k) => `<path d="M${118 + k * 16} ${y} l5 9" stroke="#4a535b" stroke-width="2"/>`).join("");
      return `<rect x="110" y="${y}" width="580" height="9" rx="4" fill="${color}"/>${estrias}<circle cx="690" cy="${y + 4.5}" r="5" fill="#4a535b"/>`;
    }).join("");
    return `
      <rect x="190" y="408" width="70" height="32" fill="${MADERA}"/><rect x="540" y="408" width="70" height="32" fill="${MADERA}"/>
      ${barras}
      <rect x="296" y="294" width="8" height="114" fill="#2f3438"/><rect x="496" y="294" width="8" height="114" fill="#2f3438"/>`;
  },
  CEMENTO: () => {
    const bolsa = (x, y) => `
      <rect x="${x}" y="${y}" width="150" height="70" rx="14" fill="#d9d4c7" stroke="#a49d8c" stroke-width="3"/>
      <rect x="${x + 40}" y="${y + 22}" width="70" height="26" rx="4" fill="#c0392b"/>
      <rect x="${x + 50}" y="${y + 31}" width="50" height="8" rx="2" fill="#f4f1ea"/>`;
    return `
      <rect x="150" y="410" width="500" height="30" fill="${MADERA}"/>
      ${[0, 1, 2].map((i) => bolsa(170 + i * 155, 340)).join("")}
      ${[0, 1].map((i) => bolsa(245 + i * 155, 270)).join("")}
      ${bolsa(320, 200)}`;
  },
  AGREGADOS: () => `
    <path d="M110 440 Q250 230 400 220 Q560 230 690 440 Z" fill="#c9a86b"/>
    <path d="M180 440 Q300 300 400 290 Q500 300 620 440 Z" fill="#b8955a" opacity="0.6"/>
    ${Array.from({ length: 40 }, (_, i) => `<circle cx="${190 + ((i * 97) % 420)}" cy="${320 + ((i * 53) % 110)}" r="${3 + (i % 4)}" fill="#8f7346"/>`).join("")}
    <rect x="560" y="330" width="16" height="110" fill="#6b4f2a" transform="rotate(20 568 385)"/>
    <path d="M590 430 l40 -10 l10 30 l-40 10 Z" fill="#7a7a7a"/>`,
  SANITARIOS: () => {
    const tubos = [0, 1, 2, 3, 4]
      .map((i) => {
        const y = 300 + i * 28;
        return `<rect x="110" y="${y}" width="380" height="26" fill="#a3aeb6"/><rect x="110" y="${y + 5}" width="380" height="5" fill="#c3ccd2"/>
          <ellipse cx="490" cy="${y + 13}" rx="8" ry="13" fill="#8a959d"/><ellipse cx="490" cy="${y + 13}" rx="4" ry="8" fill="#56616a"/>`;
      })
      .join("");
    return `
      ${tubos}
      <rect x="616" y="282" width="62" height="74" rx="8" fill="#f7f7f5" stroke="#b5b5b5" stroke-width="3"/>
      <rect x="532" y="356" width="150" height="14" rx="7" fill="#eeeeec" stroke="#b5b5b5" stroke-width="3"/>
      <path d="M540 370 H676 Q676 420 620 424 H596 Q540 420 540 370 Z" fill="#f7f7f5" stroke="#b5b5b5" stroke-width="3"/>
      <rect x="584" y="422" width="56" height="18" fill="#f7f7f5" stroke="#b5b5b5" stroke-width="3"/>`;
  },
  ELECTRICOS: () => {
    const rollo = (cx, color) => `
      <circle cx="${cx}" cy="368" r="72" fill="${color}"/>
      ${[62, 50, 38].map((r) => `<circle cx="${cx}" cy="368" r="${r}" fill="none" stroke="#00000026" stroke-width="3"/>`).join("")}
      <circle cx="${cx}" cy="368" r="24" fill="#f4f1ea"/>`;
    return `
      <path d="M300 410 Q330 445 380 436 T470 438" stroke="#d35400" stroke-width="7" fill="none" stroke-linecap="round"/>
      ${rollo(220, "#d35400")}${rollo(390, "#1f6fb2")}
      <rect x="500" y="320" width="170" height="120" rx="6" fill="#d1ad74" stroke="#9a7840" stroke-width="3"/>
      <rect x="575" y="320" width="20" height="120" fill="#c09a5e"/>
      <path d="M548 342 l-18 40 h18 l-10 36 l34 -48 h-20 l14 -28 Z" fill="#f1c40f" stroke="#b7950b" stroke-width="2"/>`;
  },
  MATERIAL: () => {
    const caja = (x, y, w, alto, color) => `
      <rect x="${x}" y="${y}" width="${w}" height="${alto}" fill="${color}" stroke="#9a7840" stroke-width="3"/>
      <rect x="${x + w / 2 - 10}" y="${y}" width="20" height="${alto}" fill="#e6d3a8" opacity="0.7"/>
      <path d="M${x + 18} ${y + 30} l10 -14 l10 14 M${x + 28} ${y + 16} v26" stroke="#7a5c2c" stroke-width="3" fill="none"/>`;
    return `
      <rect x="150" y="410" width="500" height="30" fill="${MADERA}"/>
      ${caja(180, 290, 200, 120, "#c8a165")}
      ${caja(400, 320, 220, 90, "#d1ad74")}
      ${caja(250, 200, 160, 90, "#bf9757")}`;
  },
  MANO_OBRA: () => `
    ${Array.from({ length: 5 }, (_, f) => Array.from({ length: 5 }, (_, c) => `<rect x="${380 + c * 60 + (f % 2) * 30}" y="${440 - (f + 1) * 30}" width="56" height="26" fill="#b5533c" stroke="#8e3d2b" stroke-width="2"/>`).join("")).join("")}
    <circle cx="250" cy="240" r="34" fill="#c68a5c"/>
    <path d="M206 232 a44 40 0 0 1 88 0 Z" fill="#f2c200"/><rect x="200" y="228" width="100" height="10" rx="4" fill="#d9ad00"/>
    <rect x="212" y="276" width="76" height="110" rx="12" fill="#e67e22"/>
    <rect x="212" y="310" width="76" height="10" fill="#f4f1ea"/>
    <rect x="218" y="384" width="26" height="56" fill="#2c3e50"/><rect x="256" y="384" width="26" height="56" fill="#2c3e50"/>
    <path d="M288 300 l70 40" stroke="#c68a5c" stroke-width="16" stroke-linecap="round"/>
    <path d="M356 334 l28 -6 l6 22 l-28 6 Z" fill="#7f8c8d"/>`,
  SUBCONTRATO: () => `
    <rect x="130" y="170" width="12" height="270" fill="#5d6d7e"/><rect x="300" y="170" width="12" height="270" fill="#5d6d7e"/>
    <rect x="470" y="170" width="12" height="270" fill="#5d6d7e"/>
    ${[200, 280, 360].map((y) => `<rect x="120" y="${y}" width="372" height="10" fill="#7f8c8d"/>`).join("")}
    <rect x="124" y="190" width="364" height="10" fill="${MADERA}"/><rect x="124" y="270" width="364" height="10" fill="${MADERA}"/>
    <path d="M136 280 L306 360 M306 280 L476 360 M136 360 L306 440 M306 360 L476 440" stroke="#95a5a6" stroke-width="6"/>
    <path d="M548 412 L520 432" stroke="#2d3436" stroke-width="8" stroke-linecap="round"/>
    <rect x="548" y="400" width="140" height="12" fill="#2d3436"/>
    <rect x="610" y="330" width="14" height="74" fill="#2d3436"/>
    <g transform="rotate(-22 617 320)">
      <path d="M572 282 H662 L688 330 L642 372 H592 L546 330 Z" fill="#e67e22"/>
      <path d="M560 330 H674" stroke="#c0601a" stroke-width="6"/>
      <ellipse cx="617" cy="282" rx="45" ry="10" fill="#7f4a14"/>
    </g>
    <circle cx="618" cy="418" r="24" fill="#2d3436"/><circle cx="618" cy="418" r="8" fill="#95a5a6"/>`,
};

/** Grupo de ilustración a partir del tipo de material y el rubro del ítem. */
export function grupoFoto(tipoMaterial, rubro) {
  if (rubro === "MANO OBRA") return "MANO_OBRA";
  if (rubro && rubro !== "MATERIAL") return "SUBCONTRATO";
  const t = (tipoMaterial ?? "").toUpperCase();
  if (t.includes("ACERO")) return "ACERO";
  if (t.includes("CEMENTO")) return "CEMENTO";
  if (t.includes("AGREGADO")) return "AGREGADOS";
  if (t.includes("SANITARI")) return "SANITARIOS";
  if (t.includes("ELECTRIC")) return "ELECTRICOS";
  return "MATERIAL";
}

/** SVG 800×600 del grupo; con variante impar se refleja horizontalmente. */
export function ilustracionSvg(grupo, variante = 0) {
  const dibujo = (DIBUJOS[grupo] ?? DIBUJOS.MATERIAL)();
  const espejo = variante % 2 ? ` transform="translate(800 0) scale(-1 1)"` : "";
  // Ampliación 1,2x centrada en x = 400 y con la base del dibujo (y = 440) sobre el piso (y = 470).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">${fondo(variante)}<g${espejo}><g transform="translate(-80 -58) scale(1.2)">${dibujo}</g></g></svg>`;
}
