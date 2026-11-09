import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

// El Excel de control de costos con los datos al día. No se arma uno nuevo: se toma el libro original (la plantilla, el
// mismo .xlsm que se cargó) y solo se escriben las celdas de datos que cambiaron, con su formato. Fórmulas, macros y
// hojas quedan intactas; Excel recalcula todo al abrirlo. Lo que se escribe es lo inverso de scripts/extract_excel.py:
//   DATOS (empresas y obras) · ITEMS · PROVEED · GASTOPROG (partidas, por su código) · GASTOEJEC (compras, una fila por
//   línea de orden; la línea N de la carga es la N-ésima fila válida de la hoja).
// Las hojas ya traen las fórmulas hasta su última fila: una fila nueva es llenar las celdas de datos de la siguiente vacía.

export type DatosExcel = {
  empresas: { nombre: string; ruc: string | null }[];
  obras: { nombre: string; empresa: string }[];
  items: { descripcion: string; unidad: string | null; rubro: string; tolerancia: number }[];
  proveedores: { cod: string; razon: string; comprobante: string | null; banco: string | null; cuenta: string | null }[];
  partidas: { codigo: string; obra: string; etapa: string; requerimiento: string; item: string; cantidad: number; pu: number | null }[];
  lineas: {
    id: number;
    codigo: string;
    fecha: string;
    cantidad: number;
    pu: number | null;
    aprobado: number | null;
    orden: string;
    ruc: string;
    /** Tipo y N° del comprobante: solo si se registró en la app. */
    tipo: string | null;
    comprobante: string | null;
    /** N° de operación: solo si se pagó en la app. */
    operacion: string | null;
    /** De una orden de la carga (ya tiene su fila) o nueva. */
    historica: boolean;
    /** Anulada o todavía sin precios: no es una compra. */
    fuera: boolean;
  }[];
};

type Celda = string | number | null;
type Cambios = Map<number, Map<string, Celda>>;
type Fila = Record<string, string>;

const FILAS = { items: [3, 2088], proveedores: [4, 503], obras: [12, 61], partidas: [4, 10003], lineas: [4, 15954] } as const;

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const desescapar = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clave = (s: string | null | undefined) => norm(s).toUpperCase();
const numero = (s: string | undefined) => (s === undefined || s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
/** Iguales con los 4 decimales de la base (25.78125 del Excel es el 25.7813 de la base). */
const igual = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 0.00005 + 1e-9);
const numCol = (c: string) => [...c].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0);
/** Días desde 1899-12-30: la fecha de Excel. */
const serial = (fecha: string) => Math.round((Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 864e5);

function textosCompartidos(xml: string) {
  const textos: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    textos.push([...(si[1] ?? "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((t) => desescapar(t[1] ?? "")).join(""));
  }
  return textos;
}

const FILA = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELDA = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const atributo = (attrs: string, nombre: string) => new RegExp(`\\b${nombre}="([^"]*)"`).exec(attrs)?.[1];

/** Las columnas pedidas de cada fila: el valor que se ve (también el resultado guardado de una fórmula). */
function leerHoja(xml: string, columnas: string, compartidos: string[]) {
  const filas = new Map<number, Fila>();
  for (const f of xml.matchAll(FILA)) {
    if (!f[2]) continue;
    const fila: Fila = {};
    for (const c of f[2].matchAll(CELDA)) {
      const col = /^[A-Z]+/.exec(atributo(c[1], "r") ?? "")?.[0] ?? "";
      if (!columnas.includes(col) || !c[2]) continue;
      const t = atributo(c[1], "t");
      if (t === "e") continue;
      if (t === "inlineStr") {
        fila[col] = desescapar([...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        continue;
      }
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
      if (v === undefined) continue;
      fila[col] = t === "s" ? (compartidos[Number(v)] ?? "") : desescapar(v);
    }
    filas.set(Number(atributo(f[1], "r")), fila);
  }
  return filas;
}

function celdaXml(ref: string, estilo: string | undefined, valor: Celda) {
  const s = estilo ? ` s="${estilo}"` : "";
  if (valor === null || valor === "") return `<c r="${ref}"${s}/>`;
  if (typeof valor === "number") return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
}

/** Escribe las celdas: conservan su estilo; la que tenía fórmula pasa a ser dato. */
function aplicar(xml: string, cambios: Cambios) {
  if (!cambios.size) return xml;
  return xml.replace(FILA, (todo, attrs: string, contenido: string | undefined) => {
    const n = Number(atributo(attrs, "r"));
    const cambio = cambios.get(n);
    if (!cambio) return todo;
    const celdas = new Map<string, string>();
    for (const c of (contenido ?? "").matchAll(CELDA)) {
      const col = /^[A-Z]+/.exec(atributo(c[1], "r") ?? "")?.[0] ?? "";
      celdas.set(col, c[0]);
    }
    for (const [col, valor] of cambio) {
      const antes = celdas.get(col);
      celdas.set(col, celdaXml(`${col}${n}`, antes ? atributo(/<c\b([^>]*)/.exec(antes)?.[1] ?? "", "s") : undefined, valor));
    }
    const orden = [...celdas.entries()].sort(([a], [b]) => numCol(a) - numCol(b)).map(([, c]) => c);
    return `<row${attrs}>${orden.join("")}</row>`;
  });
}

function poner(cambios: Cambios, fila: number, col: string, valor: Celda) {
  if (!cambios.has(fila)) cambios.set(fila, new Map());
  cambios.get(fila)!.set(col, valor);
}

/** La primera fila libre después de la última con dato, dentro de lo que la hoja tiene armado. */
function siguientes(filas: Map<number, Fila>, col: string, [desde, hasta]: readonly [number, number], hoja: string) {
  let ultima = desde - 1;
  for (const [n, f] of filas) if (n >= desde && n <= hasta && norm(f[col])) ultima = Math.max(ultima, n);
  return () => {
    ultima += 1;
    if (ultima > hasta) throw new Error(`La hoja ${hoja} se llenó (hasta la fila ${hasta})`);
    return ultima;
  };
}

function hojasDelLibro(archivos: Record<string, Uint8Array>) {
  const libro = strFromU8(archivos["xl/workbook.xml"]);
  const relaciones = strFromU8(archivos["xl/_rels/workbook.xml.rels"]);
  const destino = new Map([...relaciones.matchAll(/<Relationship\b[^>]*>/g)].map((r) => [atributo(r[0], "Id"), atributo(r[0], "Target")]));
  const hojas: Record<string, string> = {};
  for (const s of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const t = (destino.get(/r:id="([^"]*)"/.exec(s[0])?.[1]) ?? "").replace(/^\//, "");
    hojas[desescapar(atributo(s[0], "name") ?? "")] = t.startsWith("xl/") ? t : `xl/${t}`;
  }
  return hojas;
}

/** El libro con los datos al día. `plantilla`: el .xlsm original. Devuelve el .xlsm y qué se escribió. */
export function armarLibro(plantilla: Uint8Array, datos: DatosExcel) {
  const archivos = unzipSync(plantilla);
  const hojas = hojasDelLibro(archivos);
  for (const h of ["DATOS", "ITEMS", "PROVEED", "GASTOPROG", "GASTOEJEC"]) if (!hojas[h]) throw new Error(`La plantilla no tiene la hoja ${h}`);
  const compartidos = textosCompartidos(strFromU8(archivos["xl/sharedStrings.xml"]));
  const xml = (h: string) => strFromU8(archivos[hojas[h]]);

  // ---- DATOS
  const xmlDatos = xml("DATOS");
  const datosHoja = leerHoja(xmlDatos, "BC", compartidos);
  const cDatos: Cambios = new Map();
  for (const e of datos.empresas) {
    for (const [n, f] of datosHoja) if (n >= 2 && n <= 10 && clave(f.B) === clave(e.nombre) && e.ruc && norm(f.C) !== e.ruc) poner(cDatos, n, "C", e.ruc);
  }
  const obrasHoja = new Set([...datosHoja].filter(([n]) => n >= FILAS.obras[0]).map(([, f]) => clave(f.B)));
  const obraLibre = siguientes(datosHoja, "B", FILAS.obras, "DATOS");
  for (const o of datos.obras) {
    if (obrasHoja.has(clave(o.nombre))) continue;
    const n = obraLibre();
    poner(cDatos, n, "B", o.nombre);
    poner(cDatos, n, "C", o.empresa);
  }

  // ---- ITEMS
  const xmlItems = xml("ITEMS");
  const itemsHoja = leerHoja(xmlItems, "BCDE", compartidos);
  const filaItem = new Map<string, number>();
  for (const [n, f] of itemsHoja) if (n >= FILAS.items[0] && norm(f.B) && !filaItem.has(clave(f.B))) filaItem.set(clave(f.B), n);
  const cItems: Cambios = new Map();
  const itemLibre = siguientes(itemsHoja, "B", FILAS.items, "ITEMS");
  let itemsNuevos = 0;
  for (const i of datos.items) {
    const n = filaItem.get(clave(i.descripcion));
    if (n === undefined) {
      const libre = itemLibre();
      itemsNuevos++;
      poner(cItems, libre, "B", i.descripcion);
      poner(cItems, libre, "C", i.unidad);
      poner(cItems, libre, "D", i.rubro);
      poner(cItems, libre, "E", i.tolerancia);
      continue;
    }
    const f = itemsHoja.get(n)!;
    if (!igual(numero(f.E) ?? 0, i.tolerancia)) poner(cItems, n, "E", i.tolerancia);
    if (i.unidad && norm(f.C) !== norm(i.unidad)) poner(cItems, n, "C", i.unidad);
  }

  // ---- PROVEED
  const xmlProv = xml("PROVEED");
  const provHoja = leerHoja(xmlProv, "BCDEF", compartidos);
  const filaProv = new Map<string, number>();
  for (const [n, f] of provHoja) if (n >= FILAS.proveedores[0] && norm(f.B) && !filaProv.has(norm(f.B))) filaProv.set(norm(f.B), n);
  const cProv: Cambios = new Map();
  const provLibre = siguientes(provHoja, "B", FILAS.proveedores, "PROVEED");
  let proveedoresNuevos = 0;
  for (const p of datos.proveedores) {
    const n = filaProv.get(norm(p.cod));
    if (n === undefined) {
      const libre = provLibre();
      proveedoresNuevos++;
      poner(cProv, libre, "B", p.cod);
      poner(cProv, libre, "C", p.razon);
      poner(cProv, libre, "D", p.comprobante);
      poner(cProv, libre, "E", p.banco);
      poner(cProv, libre, "F", p.cuenta);
      continue;
    }
    const f = provHoja.get(n)!;
    if (norm(f.C) !== norm(p.razon)) poner(cProv, n, "C", p.razon);
    if (p.banco && norm(f.E) !== norm(p.banco)) poner(cProv, n, "E", p.banco);
    // El Excel escribe algunas cuentas con un «´» o «'» delante (para que no las tome como número).
    if (p.cuenta && norm(norm(f.F).replace(/^[´']+/, "")) !== norm(p.cuenta)) poner(cProv, n, "F", p.cuenta);
  }

  // ---- GASTOPROG: cada código ya tiene su fila
  const xmlProg = xml("GASTOPROG");
  const progHoja = leerHoja(xmlProg, "AJMN", compartidos);
  const filaCodigo = new Map<string, number>();
  for (const [n, f] of progHoja) if (n >= FILAS.partidas[0] && norm(f.A) && !filaCodigo.has(norm(f.A))) filaCodigo.set(norm(f.A), n);
  const cProg: Cambios = new Map();
  let partidasNuevas = 0;
  for (const p of datos.partidas) {
    const n = filaCodigo.get(p.codigo);
    if (n === undefined) throw new Error(`La hoja GASTOPROG no tiene el código ${p.codigo}`);
    const f = progHoja.get(n)!;
    if (!norm(f.J)) {
      partidasNuevas++;
      poner(cProg, n, "C", p.obra);
      poner(cProg, n, "E", p.etapa);
      poner(cProg, n, "G", p.requerimiento);
      poner(cProg, n, "J", p.item);
      poner(cProg, n, "M", p.cantidad);
      poner(cProg, n, "N", p.pu);
      continue;
    }
    if (!igual(numero(f.M) ?? 0, p.cantidad)) poner(cProg, n, "M", p.cantidad);
    if (!igual(numero(f.N), p.pu)) poner(cProg, n, "N", p.pu);
  }

  // ---- GASTOEJEC: la línea N de la carga es la N-ésima fila válida (como las cuenta extract_excel.py)
  const xmlEjec = xml("GASTOEJEC");
  const ejecHoja = leerHoja(xmlEjec, "ACDEFX", compartidos);
  const codigos = new Set(leerFilasConPartida(progHoja));
  const validas: number[] = [];
  for (const [n, f] of [...ejecHoja].sort(([a], [b]) => a - b)) {
    if (n < FILAS.lineas[0] || n > FILAS.lineas[1] || !norm(f.A) || !codigos.has(norm(f.A))) continue;
    if (!((numero(f.C) ?? 0) > 0) || !norm(f.F)) continue;
    validas.push(n);
  }
  const cEjec: Cambios = new Map();
  const ejecLibre = siguientes(ejecHoja, "A", FILAS.lineas, "GASTOEJEC");
  let lineasNuevas = 0;
  const vistas = new Set<number>();
  for (const l of [...datos.lineas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)) {
    // Nueva: de una orden de la app, o agregada después a una de la carga.
    if (!l.historica || l.id > validas.length) {
      if (l.fuera) continue;
      const n = ejecLibre();
      lineasNuevas++;
      poner(cEjec, n, "A", l.codigo);
      poner(cEjec, n, "B", serial(l.fecha));
      poner(cEjec, n, "C", l.cantidad);
      poner(cEjec, n, "D", l.pu);
      poner(cEjec, n, "E", l.orden);
      poner(cEjec, n, "F", l.ruc);
      poner(cEjec, n, "G", l.tipo);
      poner(cEjec, n, "H", l.comprobante);
      poner(cEjec, n, "I", l.operacion);
      if (l.aprobado !== null) poner(cEjec, n, "X", l.aprobado);
      continue;
    }
    const n = validas[l.id - 1];
    const f = n === undefined ? undefined : ejecHoja.get(n);
    if (!f || norm(f.A) !== l.codigo) throw new Error(`La plantilla no coincide con la carga (línea ${l.id}): súbela de nuevo`);
    vistas.add(l.id);
    if (l.fuera) {
      for (const col of "ABCDEFGHIX") poner(cEjec, n, col, null);
      continue;
    }
    if (!igual(numero(f.C), l.cantidad)) poner(cEjec, n, "C", l.cantidad);
    if (!igual(numero(f.D), l.pu)) poner(cEjec, n, "D", l.pu);
    if (!igual(numero(f.X), l.aprobado)) poner(cEjec, n, "X", l.aprobado);
    if (l.comprobante) {
      poner(cEjec, n, "G", l.tipo);
      poner(cEjec, n, "H", l.comprobante);
    }
    if (l.operacion) poner(cEjec, n, "I", l.operacion);
  }
  // Una línea de la carga que ya no existe (se quitó de su orden): su fila se vacía.
  validas.forEach((n, i) => {
    if (!vistas.has(i + 1)) for (const col of "ABCDEFGHIX") poner(cEjec, n, col, null);
  });

  // ---- El libro: lo que cambió, y que Excel recalcule al abrir (la cadena de cálculo se rearma sola)
  const salida: Zippable = {};
  for (const [nombre, contenido] of Object.entries(archivos)) {
    if (nombre === "xl/calcChain.xml") continue;
    salida[nombre] = contenido;
  }
  salida[hojas.DATOS] = strToU8(aplicar(xmlDatos, cDatos));
  salida[hojas.ITEMS] = strToU8(aplicar(xmlItems, cItems));
  salida[hojas.PROVEED] = strToU8(aplicar(xmlProv, cProv));
  salida[hojas.GASTOPROG] = strToU8(aplicar(xmlProg, cProg));
  salida[hojas.GASTOEJEC] = strToU8(aplicar(xmlEjec, cEjec));
  const libro = strFromU8(archivos["xl/workbook.xml"]);
  salida["xl/workbook.xml"] = strToU8(
    /<calcPr\b/.test(libro)
      ? libro.replace(/<calcPr\b([^>]*?)\/?>/, (_, a: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`)
      : libro.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'),
  );
  salida["[Content_Types].xml"] = strToU8(strFromU8(archivos["[Content_Types].xml"]).replace(/<Override\b[^>]*calcChain[^>]*\/>/, ""));
  salida["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(archivos["xl/_rels/workbook.xml.rels"]).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ""));

  return { archivo: zipSync(salida, { level: 6 }), resumen: { itemsNuevos, proveedoresNuevos, partidasNuevas, lineasNuevas } };
}

/** Los códigos con partida: los que tienen descripción (los demás están preparados, sin usar). */
function leerFilasConPartida(prog: Map<number, Fila>) {
  return [...prog].filter(([n, f]) => n >= FILAS.partidas[0] && norm(f.J)).map(([, f]) => norm(f.A));
}
