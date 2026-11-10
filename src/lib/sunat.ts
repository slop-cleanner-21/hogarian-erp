// Archivos para SUNAT y vencimientos.
//
// Pago masivo de detracciones por internet (instructivo de SUNAT «Pago masivo de detracciones», numeral 5): archivo de texto
// D<RUC del adquiriente><lote>.txt; la primera línea (cabecera, 68 caracteres) y una por depósito (107 caracteres). Los
// importes, en soles enteros: 13 dígitos de enteros y «00» de decimales, sin punto. Lo que no llena su ancho, con espacios.
//
// PLAME, rentas de cuarta categoría: 0601<AAAA><MM><RUC>.ps4 (estructura 7: los prestadores) y .4ta (estructura 20: sus
// recibos), con los campos separados por «|». Primero se importa el .ps4 y luego el .4ta.

/** Códigos de bienes y servicios sujetos a detracción vigentes (tabla 5.4 del instructivo). */
export const CODIGOS_DETRACCION: { codigo: string; nombre: string }[] = [
  { codigo: "004", nombre: "Recursos hidrobiológicos" },
  { codigo: "005", nombre: "Maíz amarillo duro" },
  { codigo: "008", nombre: "Madera" },
  { codigo: "009", nombre: "Arena y piedra" },
  { codigo: "010", nombre: "Residuos, subproductos, desechos y desperdicios" },
  { codigo: "012", nombre: "Intermediación laboral y tercerización" },
  { codigo: "014", nombre: "Carnes y despojos comestibles" },
  { codigo: "017", nombre: "Harina, polvo y pellets de pescado" },
  { codigo: "019", nombre: "Arrendamiento de bienes" },
  { codigo: "020", nombre: "Mantenimiento y reparación de bienes muebles" },
  { codigo: "021", nombre: "Movimiento de carga" },
  { codigo: "022", nombre: "Otros servicios empresariales" },
  { codigo: "024", nombre: "Comisión mercantil" },
  { codigo: "025", nombre: "Fabricación de bienes por encargo" },
  { codigo: "026", nombre: "Servicio de transporte de personas" },
  { codigo: "027", nombre: "Servicio de transporte de bienes por vía terrestre" },
  { codigo: "030", nombre: "Contratos de construcción" },
  { codigo: "031", nombre: "Oro gravado con el IGV" },
  { codigo: "034", nombre: "Minerales metálicos no auríferos" },
  { codigo: "035", nombre: "Bienes exonerados del IGV" },
  { codigo: "036", nombre: "Oro y demás minerales metálicos exonerados del IGV" },
  { codigo: "037", nombre: "Demás servicios gravados con el IGV" },
  { codigo: "039", nombre: "Minerales no metálicos" },
  { codigo: "040", nombre: "Bien inmueble gravado con el IGV" },
];

/** El código más probable por el porcentaje de la detracción (se puede cambiar en cada una). */
export function codigoPorPorcentaje(pct: number) {
  if (Math.abs(pct - 4) < 0.6) return "030";
  if (Math.abs(pct - 10) < 0.6) return "019";
  return "037";
}

const izquierda = (s: string, n: number) => s.slice(0, n).padEnd(n, " ");
const ceros = (s: string, n: number) => s.replace(/\D/g, "").slice(-n).padStart(n, "0");
/** Soles enteros redondeados, como pide SUNAT: 13 enteros y «00». */
const importe = (soles: number) => `${String(Math.round(soles)).padStart(13, "0")}00`;
/** Para el nombre: mayúsculas sin tildes ni signos raros. */
const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type DepositoDetraccion = {
  ruc: string;
  proveedor: string;
  cuenta: string | null;
  codigo: string;
  monto: number;
  /** AAAAMM de la emisión del comprobante. */
  periodo: string;
  serie: string;
  numero: string;
};

/** Lo que impide armar el archivo (RUC, cuenta de detracciones, lote). */
export function erroresDetracciones(ruc: string, lote: string, depositos: DepositoDetraccion[]) {
  const errores: string[] = [];
  if (!/^\d{11}$/.test(ruc)) errores.push("la empresa no tiene un RUC de 11 dígitos");
  if (!/^\d{6}$/.test(lote)) errores.push("el lote son 6 dígitos (año y correlativo: 260001)");
  for (const d of depositos) {
    if (!/^\d{11}$/.test(d.ruc)) errores.push(`${d.proveedor}: no tiene RUC`);
    if (!d.cuenta || !/^\d{11}$/.test(d.cuenta)) errores.push(`${d.proveedor}: falta su cuenta de detracciones (11 dígitos)`);
    if (!CODIGOS_DETRACCION.some((c) => c.codigo === d.codigo)) errores.push(`${d.serie}-${d.numero}: código de bien o servicio inválido`);
    if (!(Math.round(d.monto) > 0)) errores.push(`${d.serie}-${d.numero}: la detracción redondeada es 0`);
  }
  return errores;
}

/** El TXT del pago masivo (por internet). Cada línea termina en CRLF. */
export function txtDetracciones(empresa: { ruc: string; razonSocial: string }, lote: string, depositos: DepositoDetraccion[]) {
  const total = depositos.reduce((a, d) => a + Math.round(d.monto), 0);
  const cabecera = `*${ceros(empresa.ruc, 11)}${izquierda(plano(empresa.razonSocial), 35)}${ceros(lote, 6)}${importe(total)}`;
  const detalle = depositos.map(
    (d) =>
      `6${ceros(d.ruc, 11)}${" ".repeat(35)}${"0".repeat(9)}${d.codigo}${ceros(d.cuenta ?? "", 11)}${importe(d.monto)}01${d.periodo}01${izquierda(d.serie.toUpperCase(), 4)}${ceros(d.numero, 8)}`,
  );
  return { nombre: `D${empresa.ruc}${lote}.txt`, contenido: [cabecera, ...detalle].join("\r\n") + "\r\n", total };
}

export type ReciboPlame = {
  /** El RUC (10…) o DNI del prestador. */
  documento: string;
  /** Razón social tal como está: «APELLIDO APELLIDO NOMBRES». */
  nombre: string;
  serie: string;
  numero: string;
  total: number;
  emision: string;
  pago: string;
  retencion: number;
};

const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Tipo de documento del prestador (tabla 3 del PLAME): 06 RUC, 01 DNI. */
const tipoDocumento = (doc: string) => (/^\d{11}$/.test(doc) ? "06" : "01");

/** Los dos archivos del PLAME para un mes: prestadores (.ps4) y recibos (.4ta). */
export function archivosPlame(ruc: string, periodo: string, recibos: ReciboPlame[]) {
  const base = `0601${periodo.slice(0, 4)}${periodo.slice(4)}${ruc}`;
  const prestadores = new Map<string, ReciboPlame>();
  for (const r of recibos) prestadores.set(r.documento, r);
  const ps4 = [...prestadores.values()].map((r) => {
    // La razón social de una persona viene «APELLIDO APELLIDO NOMBRES».
    const partes = plano(r.nombre).split(" ");
    const [paterno = "", materno = "", ...nombres] = partes;
    return [tipoDocumento(r.documento), r.documento, paterno, materno, nombres.join(" "), "1", "0"].join("|") + "|";
  });
  const cuarta = recibos.map(
    (r) =>
      [
        tipoDocumento(r.documento),
        r.documento,
        "R",
        r.serie.toUpperCase().slice(0, 4),
        r.numero.replace(/\D/g, "").slice(-8),
        r.total.toFixed(2),
        ddmmaaaa(r.emision),
        ddmmaaaa(r.pago),
        r.retencion > 0 ? "1" : "0",
        "",
      ].join("|") + "|",
  );
  return {
    ps4: { nombre: `${base}.ps4`, contenido: ps4.join("\r\n") + "\r\n" },
    cuarta: { nombre: `${base}.4ta`, contenido: cuarta.join("\r\n") + "\r\n" },
  };
}

// ----------------------------------------------------------------------------------------------- vencimientos
/** Domingo de Pascua (algoritmo de Meeus). */
function pascua(anio: number) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** Feriados nacionales del Perú de un año (los fijos, y Jueves y Viernes Santo). */
export function feriados(anio: number) {
  const fijos = ["01-01", "05-01", "06-07", "06-29", "07-23", "07-28", "07-29", "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25"];
  const p = pascua(anio);
  const santo = [-3, -2].map((d) => new Date(p.getTime() + d * 864e5).toISOString().slice(0, 10));
  return new Set([...fijos.map((f) => `${anio}-${f}`), ...santo]);
}

/** El quinto día hábil del mes siguiente al periodo AAAAMM (plazo de la detracción de un servicio). */
export function quintoDiaHabil(periodo: string) {
  let anio = Number(periodo.slice(0, 4));
  let mes = Number(periodo.slice(4, 6)) + 1;
  if (mes === 13) {
    mes = 1;
    anio++;
  }
  const libres = feriados(anio);
  const d = new Date(Date.UTC(anio, mes - 1, 1));
  let habiles = 0;
  for (;;) {
    const iso = d.toISOString().slice(0, 10);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6 && !libres.has(iso)) habiles++;
    if (habiles === 5) return iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
