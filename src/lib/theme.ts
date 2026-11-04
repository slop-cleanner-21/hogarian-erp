export const THEME_KEY = "erp-theme";
/** El proveedor (link de cotización) tiene su propio tema: claro salvo que él elija oscuro. */
export const THEME_KEY_PROVEEDOR = "erp-theme-proveedor";
export type Theme = "light" | "dark" | "system";

/** Fondo de la app en cada tema: lo usan las barras del sistema (estado y navegación). */
export const COLOR_BARRA = { light: "#e7e9e4", dark: "#121614" } as const;

export const esRutaProveedor = (path: string) => path.startsWith("/cotizar");

/**
 * Script previo al primer pintado: aplica el tema guardado (data-theme). El color de las barras
 * del sistema (meta theme-color) lo alinea después BarrasSistema.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,t=null,p=location.pathname.indexOf("/cotizar")===0;try{t=localStorage.getItem(p?"${THEME_KEY_PROVEEDOR}":"${THEME_KEY}")}catch(e){}if(p&&t!=="dark")t="light";if(t==="light"||t==="dark")d.dataset.theme=t})()`;
