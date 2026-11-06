/**
 * Solo una ruta de la app, nunca otro dominio. Se resuelve como lo haría el navegador (que toma `\` como `/` y quita
 * tabuladores y saltos: `/\otro.com` y `/<tab>/otro.com` son `//otro.com`) y se exige el mismo origen.
 */
export function rutaInterna(volver: string | string[] | undefined) {
  if (typeof volver !== "string" || !volver.startsWith("/")) return "/";
  const base = "https://erp.invalid";
  let url: URL;
  try {
    url = new URL(volver, base);
  } catch {
    return "/";
  }
  const ruta = `${url.pathname}${url.search}`;
  if (url.origin !== base || ruta.startsWith("//") || url.pathname.startsWith("/desbloquear") || url.pathname.startsWith("/rol")) return "/";
  return ruta;
}
