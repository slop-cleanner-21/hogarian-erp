// Ítems con nombre parecido al que se está creando, para no duplicar el catálogo («CEMENTO TIPO I» y
// «CEMENTO TIPO 1», «TUBO PVC 2"» y «TUBO DE 2" PVC»). Sin tildes, mayúsculas ni comillas tipográficas;
// cuenta las palabras en común aunque estén en otro orden, abreviadas (prefijo), en plural o con una letra cambiada.
//
// Tres grados:
// - `igual`: el mismo ítem escrito de otra forma (espacios, guiones, puntos, «N°», plural, conectores, otro orden):
//   no se deja crear («PRE VIGUETAS» y «PRE-VIGUETAS», «CALZADURA DE MUROS COLINDANTES» y «CALZADURA EN MURO
//   COLINDANTE»).
// - `casi`: una letra de diferencia en una palabra o una letra suelta de más («CEMNTO» y «CEMENTO», «… C-7.5 (U)»
//   y «… C-7.5», «LADRILO KINGKONG» y «LADRILLO KING KONG»): hay que confirmar que es otro. Las cifras nunca se toleran: «ACERO DE 1/2"» y «ACERO DE 1/4"»
//   son distintos, y también «C1» y «C1A» o «MUROS» y «PISOS».
// - el resto: comparten palabras; solo se muestran.

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "x", "para", "con", "en", "a", "c", "al", "por"]);

/** Texto comparable: minúsculas, sin tildes, comillas unificadas y espacios simples. */
export const normalizarItem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”″]|''/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[^a-z0-9/"'.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const conCifra = (p: string) => /\d/.test(p);

/** La raíz de una palabra: sin plural ni la «e» final («colindantes» y «colindante», «conexiones» y «conexion»). */
const raiz = (p: string) => {
  if (conCifra(p) || /["'/]/.test(p) || p.length <= 3) return p;
  const sin = p.endsWith("es") && p.length > 4 ? p.slice(0, -2) : p.endsWith("s") ? p.slice(0, -1) : p;
  return sin.length > 3 && sin.endsWith("e") ? sin.slice(0, -1) : sin;
};

/** Las palabras que cuentan, en raíz: sin conectores, sin «N°» delante de una cifra y sin puntos sueltos. */
function terminos(s: string) {
  const t = normalizarItem(s)
    .replace(/\b(n|nro|no|num)\s*\.?\s*(?=\d)/g, "")
    .replace(/(\d)\s*(pulgadas?|pulg|plg)\b\.?/g, '$1"')
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, " ")
    .split(" ")
    .filter((p) => p && !VACIAS.has(p));
  return t.map(raiz);
}

/** Distancia de edición (cambios de una letra), cortando apenas pasa de `max`. */
function distancia(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      menor = Math.min(menor, nueva[j]);
    }
    if (menor > max) return max + 1;
    fila = nueva;
  }
  return fila[b.length];
}

/** Una errata: palabras sin cifras de 4 letras o más, a una letra (dos si son largas). */
const errata = (a: string, b: string) =>
  !conCifra(a) && !conCifra(b) && Math.min(a.length, b.length) >= 4 && distancia(a, b, a.length >= 8 ? 2 : 1) <= (a.length >= 8 ? 2 : 1);

// Dos palabras coinciden si son iguales (en raíz), una empieza con la otra (3 letras o más: «tub» y «tubo») o es una errata.
const coinciden = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && !conCifra(a) && !conCifra(b) && (a.startsWith(b) || b.startsWith(a))) || errata(a, b);

const ordenadas = (t: string[]) => [...t].sort().join(" ");

/** Las medidas y números, en orden: tienen que ser los mismos («TIPO 2 - PISO 1» no es «TIPO 1 - PISO 2»). */
const cifras = (t: string[]) => t.filter(conCifra).join(" ");

/** El mismo ítem escrito de otra forma. */
function mismoItem(a: string[], b: string[]) {
  return a.join("") === b.join("") || (cifras(a) === cifras(b) && ordenadas(a) === ordenadas(b));
}

/** Casi el mismo: una palabra con una errata, o una letra suelta de más. */
function casiIgual(a: string[], b: string[]) {
  if (cifras(a) !== cifras(b)) return false;
  // Con los espacios en otro lugar («KING KONG» y «KINGKONG»), una errata en el texto corrido.
  const [ja, jb] = [a.join(""), b.join("")];
  const tope = Math.min(ja.length, jb.length) >= 15 ? 2 : 1;
  if (Math.min(ja.length, jb.length) >= 8 && distancia(ja, jb, tope) <= tope) return true;
  if (a.length === b.length) {
    const distintas = a.map((p, i) => [p, b[i]]).filter(([p, q]) => p !== q);
    return distintas.length === 1 && errata(distintas[0][0], distintas[0][1]);
  }
  const [larga, corta] = a.length > b.length ? [a, b] : [b, a];
  if (larga.length - corta.length !== 1) return false;
  const i = larga.findIndex((p, k) => p !== corta[k]);
  const sobra = larga[i === -1 ? larga.length - 1 : i];
  return sobra.length === 1 && !conCifra(sobra) && larga.filter((_, k) => k !== (i === -1 ? larga.length - 1 : i)).join(" ") === corta.join(" ");
}

// Para el puntaje: sin letras sueltas («TIPO I»), con ellas «ESCALERA TIPO I» se parecía a «CEMENTO TIPO I».
const palabras = (t: string[]) => t.filter((p) => !/^[a-z]$/.test(p));

export type Parecido<T> = { item: T; igual: boolean; casi: boolean; puntaje: number };

/**
 * Los más parecidos a `texto` (hasta `max`), del más al menos parecido. `igual`: el mismo ítem escrito de otra
 * forma (no se deja crear); `casi`: con una errata (se confirma). Para el resto hace falta compartir al menos
 * la mitad de las palabras (y la primera), o contener lo escrito.
 */
export function parecidos<T extends { descripcion: string }>(texto: string, catalogo: T[], max = 5): Parecido<T>[] {
  const buscado = normalizarItem(texto);
  const tb = terminos(texto);
  const pb = palabras(tb);
  if (buscado.length < 3 || tb.length === 0) return [];
  const res: Parecido<T>[] = [];
  for (const item of catalogo) {
    const ti = terminos(item.descripcion);
    if (ti.length === 0) continue;
    if (normalizarItem(item.descripcion) === buscado || mismoItem(tb, ti)) {
      res.push({ item, igual: true, casi: false, puntaje: 3 });
      continue;
    }
    if (casiIgual(tb, ti)) {
      res.push({ item, igual: false, casi: true, puntaje: 2 });
      continue;
    }
    const pi = palabras(ti);
    if (pb.length === 0 || pi.length === 0) continue;
    const comunes = pb.filter((p) => pi.some((q) => coinciden(p, q))).length;
    // Proporción sobre la frase más larga: «CEMENTO» no se parece tanto a «CEMENTO TIPO I EXTRA FORTE».
    const puntaje = comunes / Math.max(pb.length, pi.length);
    // La primera palabra suele ser lo que es (CEMENTO, TUBO, ACERO): con la mitad en común debe coincidir
    // («ESCALERA TIPO I» no se parece a «CEMENTO TIPO I»); con más, basta.
    const mismaCosa = coinciden(pb[0], pi[0]);
    const contiene = normalizarItem(item.descripcion).includes(buscado);
    if (comunes > 0 && ((puntaje >= 0.5 && mismaCosa) || puntaje > 0.6 || contiene)) res.push({ item, igual: false, casi: false, puntaje });
  }
  return res.sort((a, b) => b.puntaje - a.puntaje || a.item.descripcion.length - b.item.descripcion.length).slice(0, max);
}
