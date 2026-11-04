// Ítems con nombre parecido al que se está creando, para no duplicar el catálogo («CEMENTO TIPO I» y
// «CEMENTO TIPO 1», «TUBO PVC 2"» y «TUBO DE 2" PVC»). Sin tildes, mayúsculas ni comillas tipográficas;
// cuenta las palabras en común aunque estén en otro orden o abreviadas (prefijo).

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "x", "para", "con", "en", "a", "c"]);

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

// Sin letras sueltas («TIPO I»): con ellas, «ESCALERA TIPO I» se parecía a «CEMENTO TIPO I».
const palabras = (s: string) => normalizarItem(s).split(" ").filter((p) => p && !VACIAS.has(p) && !/^[a-z]$/.test(p));

// Dos palabras coinciden si son iguales o una empieza con la otra (de 3 letras o más: «tub» y «tubo»).
const coinciden = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

export type Parecido<T> = { item: T; igual: boolean; puntaje: number };

/**
 * Los más parecidos a `texto` (hasta `max`), del más al menos parecido. `igual`: el mismo nombre ya
 * normalizado (la base solo impide el idéntico). Hace falta compartir al menos la mitad de las palabras (y la
 * primera), o contener lo escrito.
 */
export function parecidos<T extends { descripcion: string }>(texto: string, catalogo: T[], max = 5): Parecido<T>[] {
  const buscado = normalizarItem(texto);
  const pb = palabras(texto);
  if (buscado.length < 3 || pb.length === 0) return [];
  const res: Parecido<T>[] = [];
  for (const item of catalogo) {
    const n = normalizarItem(item.descripcion);
    if (n === buscado) {
      res.push({ item, igual: true, puntaje: 2 });
      continue;
    }
    const pi = palabras(item.descripcion);
    if (pi.length === 0) continue;
    const comunes = pb.filter((p) => pi.some((q) => coinciden(p, q))).length;
    // Proporción sobre la frase más larga: «CEMENTO» no se parece tanto a «CEMENTO TIPO I EXTRA FORTE».
    const puntaje = comunes / Math.max(pb.length, pi.length);
    // La primera palabra suele ser lo que es (CEMENTO, TUBO, ACERO): con la mitad en común debe coincidir
    // («ESCALERA TIPO I» no se parece a «CEMENTO TIPO I»); con más, basta.
    const mismaCosa = coinciden(pb[0], pi[0]);
    if (comunes > 0 && ((puntaje >= 0.5 && mismaCosa) || puntaje > 0.6 || n.includes(buscado))) res.push({ item, igual: false, puntaje });
  }
  return res.sort((a, b) => b.puntaje - a.puntaje || a.item.descripcion.length - b.item.descripcion.length).slice(0, max);
}
