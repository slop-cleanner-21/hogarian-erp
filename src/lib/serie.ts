// Serie de facturas, boletas y recibos por honorarios: 4 caracteres (F001, E001, 0001), como la pide el
// SIRE. Se valida en el navegador antes de subir el archivo y en el servidor antes de registrar.
export const SERIE_INVALIDA = "La serie tiene 4 caracteres (F001, E001, 0001)";
export const serieValida = (tipo: string, serie: string) =>
  !["FACTURA", "BOLETA", "RXH"].includes(tipo) || /^[A-Z0-9]{4}$/i.test(serie.trim());
