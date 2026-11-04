// Bloqueo con huella: claves del navegador y el script previo al primer pintado. Compartido por el layout (servidor)
// y el bloqueo (cliente).

/** Huella activada en este dispositivo: { u: usuario, e: correo, c: credencial } (localStorage). */
export const CLAVE_HUELLA = "prod1_huella";
/** Esta pestaña o la app ya entró o se desbloqueó (sessionStorage). */
export const CLAVE_ABIERTA = "prod1_huella_abierta";

/** Rutas sin sesión o que no se bloquean. */
export const RUTAS_LIBRES = ["/login", "/cotizar", "/acceso", "/sin-acceso", "/voucher-simulado"];

/**
 * Antes del primer pintado: si toca pedir la huella (activada aquí y la app recién abierta), la pantalla no se
 * muestra (html[data-bloqueo]) hasta que el bloqueo la tape o se desbloquee. Sin esto, se veía el contenido
 * mientras cargaba la app y después saltaba el bloqueo.
 */
export const BLOQUEO_SCRIPT = `(function(){try{var p=location.pathname;if(${JSON.stringify(RUTAS_LIBRES)}.some(function(r){return p===r||p.indexOf(r+"/")===0}))return;if(localStorage.getItem("${CLAVE_HUELLA}")&&sessionStorage.getItem("${CLAVE_ABIERTA}")!=="1")document.documentElement.dataset.bloqueo="1"}catch(e){}})()`;

/** Vuelve a mostrar la pantalla (desbloqueada, o no había que bloquear). */
export function quitarVelo() {
  delete document.documentElement.dataset.bloqueo;
}
