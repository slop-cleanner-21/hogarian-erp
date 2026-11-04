import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const dosDecimales = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitario = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const cantidad = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 4 });

export const money = (n: number | null | undefined) => (n == null ? "—" : dosDecimales.format(Number(n)));
/** Precio unitario: hasta 4 decimales, para que cantidad × P.U. cuadre con el parcial. */
export const precio = (n: number | null | undefined) => (n == null ? "—" : unitario.format(Number(n)));
export const qty = (n: number | null | undefined) => (n == null ? "—" : cantidad.format(Number(n)));
/** Monto y precio con su moneda, para que quede claro que es dinero (prod 1: siempre «S/»). */
export const soles = (n: number | null | undefined) => (n == null ? "—" : `S/ ${money(n)}`);
export const solesPu = (n: number | null | undefined) => (n == null ? "—" : `S/ ${precio(n)}`);

export function fecha(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });

/** Normaliza texto para búsquedas: minúsculas, sin tildes. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matches(haystack: string, query: string) {
  const h = norm(haystack);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => h.includes(t));
}

/** Teléfono a formato internacional sin "+" (Perú por defecto): "987 654 321" -> "51987654321". */
export function telefonoIntl(t: string) {
  const d = t.replace(/\D/g, "");
  if (d.length === 9 && d.startsWith("9")) return `51${d}`;
  return d;
}
