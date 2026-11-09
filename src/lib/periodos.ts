const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

/** '202610' -> 'Oct 2026' */
export const periodoLabel = (p: string) => `${MESES[Number(p.slice(4, 6)) - 1]} ${p.slice(0, 4)}`;

/** Periodos AAAAMM entre `desde` y `hasta`, del más reciente al más antiguo. */
export function rangoPeriodos(desde: string | null, hasta: string | null) {
  if (!desde || !hasta) return [];
  const out: string[] = [];
  let y = Number(hasta.slice(0, 4));
  let m = Number(hasta.slice(4, 6));
  while (`${y}${String(m).padStart(2, "0")}` >= desde) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
