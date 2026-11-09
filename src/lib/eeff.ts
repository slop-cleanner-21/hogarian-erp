// Estados financieros a partir de las sumas por cuenta de los asientos (función sumas_cuentas). Todo en soles, al céntimo.
//
// - Balance de comprobación: cada cuenta con sus sumas y su saldo deudor o acreedor.
// - Situación financiera: por cuenta de 2 dígitos (elemento del PCGE). En las clases 1 a 4 el saldo decide el lado: deudor,
//   activo; acreedor, pasivo (el IGV por acreditar de la 40 va al activo; un banco con saldo acreedor, al pasivo). La clase 5
//   es patrimonio y el resultado del ejercicio es lo que queda de las clases 6 a 9: así el balance siempre cuadra.
// - Resultados por naturaleza: ingresos 70-78 menos gastos 60-69 (la 79 no: es la contrapartida de la clase 9). La clase 9
//   (costos y gastos por función) se muestra aparte; si no cuadra con la 79, la diferencia queda a la vista.

export type Suma = { cuenta: string; denominacion: string | null; debe: number; haber: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Elementos del PCGE (2 dígitos), para nombrar los grupos. */
export const ELEMENTOS: Record<string, string> = {
  "10": "Efectivo y equivalentes de efectivo",
  "11": "Inversiones financieras",
  "12": "Cuentas por cobrar comerciales - terceros",
  "13": "Cuentas por cobrar comerciales - relacionadas",
  "14": "Cuentas por cobrar al personal, accionistas y directores",
  "16": "Cuentas por cobrar diversas - terceros",
  "17": "Cuentas por cobrar diversas - relacionadas",
  "18": "Servicios y otros contratados por anticipado",
  "19": "Estimación de cuentas de cobranza dudosa",
  "20": "Mercaderías",
  "21": "Productos terminados",
  "23": "Productos en proceso",
  "24": "Materias primas",
  "25": "Materiales auxiliares, suministros y repuestos",
  "28": "Inventarios por recibir",
  "33": "Inmuebles, maquinaria y equipo",
  "34": "Intangibles",
  "37": "Activo diferido",
  "39": "Depreciación, amortización y agotamiento acumulados",
  "40": "Tributos, contraprestaciones y aportes por pagar",
  "41": "Remuneraciones y participaciones por pagar",
  "42": "Cuentas por pagar comerciales - terceros",
  "43": "Cuentas por pagar comerciales - relacionadas",
  "44": "Cuentas por pagar a los accionistas, directores y gerentes",
  "45": "Obligaciones financieras",
  "46": "Cuentas por pagar diversas - terceros",
  "47": "Cuentas por pagar diversas - relacionadas",
  "50": "Capital",
  "52": "Capital adicional",
  "58": "Reservas",
  "59": "Resultados acumulados",
  "60": "Compras",
  "61": "Variación de inventarios",
  "62": "Gastos de personal",
  "63": "Gastos de servicios prestados por terceros",
  "64": "Gastos por tributos",
  "65": "Otros gastos de gestión",
  "66": "Pérdida por medición de activos no financieros al valor razonable",
  "67": "Gastos financieros",
  "68": "Valuación y deterioro de activos y provisiones",
  "69": "Costo de ventas",
  "70": "Ventas",
  "71": "Variación de la producción almacenada",
  "72": "Producción de activo inmovilizado",
  "73": "Descuentos, rebajas y bonificaciones obtenidos",
  "74": "Descuentos, rebajas y bonificaciones concedidos",
  "75": "Otros ingresos de gestión",
  "76": "Ganancia por medición de activos no financieros al valor razonable",
  "77": "Ingresos financieros",
  "78": "Cargas cubiertas por provisiones",
  "79": "Cargas imputables a cuentas de costos y gastos",
};
export const nombreElemento = (dos: string) => ELEMENTOS[dos] ?? `Cuenta ${dos}`;

export type FilaComprobacion = Suma & { deudor: number; acreedor: number };

export function comprobacion(sumas: Suma[]) {
  const filas: FilaComprobacion[] = sumas.map((s) => {
    const saldo = r2(s.debe - s.haber);
    return { ...s, deudor: saldo > 0 ? saldo : 0, acreedor: saldo < 0 ? -saldo : 0 };
  });
  const tot = filas.reduce(
    (a, f) => ({ debe: r2(a.debe + f.debe), haber: r2(a.haber + f.haber), deudor: r2(a.deudor + f.deudor), acreedor: r2(a.acreedor + f.acreedor) }),
    { debe: 0, haber: 0, deudor: 0, acreedor: 0 },
  );
  return { filas, totales: tot, cuadra: tot.debe === tot.haber && tot.deudor === tot.acreedor };
}

export type Linea = { codigo: string; nombre: string; monto: number };

/** Saldo (Debe − Haber) por elemento de 2 dígitos, solo de las cuentas que cumplen `filtro`. */
function porElemento(sumas: Suma[], filtro: (c: string) => boolean) {
  const m = new Map<string, number>();
  for (const s of sumas) if (filtro(s.cuenta)) m.set(s.cuenta.slice(0, 2), r2((m.get(s.cuenta.slice(0, 2)) ?? 0) + s.debe - s.haber));
  return [...m.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b));
}

const suma = (l: Linea[]) => r2(l.reduce((a, x) => a + x.monto, 0));
const clase = (c: string) => Number(c[0]);

export function situacion(sumas: Suma[]) {
  const balance = porElemento(sumas, (c) => clase(c) >= 1 && clase(c) <= 4);
  const activoCorriente: Linea[] = [];
  const activoNoCorriente: Linea[] = [];
  const pasivo: Linea[] = [];
  for (const [codigo, saldo] of balance) {
    const linea = { codigo, nombre: nombreElemento(codigo), monto: Math.abs(saldo) };
    if (saldo > 0) (clase(codigo) === 3 ? activoNoCorriente : activoCorriente).push(linea);
    else pasivo.push(linea);
  }
  const patrimonio: Linea[] = porElemento(sumas, (c) => clase(c) === 5).map(([codigo, saldo]) => ({ codigo, nombre: nombreElemento(codigo), monto: -saldo }));
  // Lo que queda de las clases 6 a 9 (gastos, ingresos y costos): ganancia si es acreedor.
  const resultado = r2(-sumas.filter((s) => clase(s.cuenta) >= 6).reduce((a, s) => a + s.debe - s.haber, 0));
  const activo = r2(suma(activoCorriente) + suma(activoNoCorriente));
  const pasivoTotal = suma(pasivo);
  const patrimonioTotal = r2(suma(patrimonio) + resultado);
  return {
    activoCorriente,
    activoNoCorriente,
    activo,
    pasivo,
    pasivoTotal,
    patrimonio,
    resultado,
    patrimonioTotal,
    cuadra: activo === r2(pasivoTotal + patrimonioTotal),
  };
}

export function resultados(sumas: Suma[]) {
  const ingresos: Linea[] = porElemento(sumas, (c) => c.startsWith("7") && !c.startsWith("79")).map(([codigo, saldo]) => ({
    codigo,
    nombre: nombreElemento(codigo),
    monto: -saldo,
  }));
  const gastos: Linea[] = porElemento(sumas, (c) => c.startsWith("6")).map(([codigo, saldo]) => ({ codigo, nombre: nombreElemento(codigo), monto: saldo }));
  const funcion: Linea[] = sumas
    .filter((s) => s.cuenta.startsWith("9"))
    .map((s) => ({ codigo: s.cuenta, nombre: s.denominacion ?? `Cuenta ${s.cuenta}`, monto: r2(s.debe - s.haber) }))
    .filter((l) => l.monto !== 0);
  const cargas79 = r2(-sumas.filter((s) => s.cuenta.startsWith("79")).reduce((a, s) => a + s.debe - s.haber, 0));
  const totalFuncion = suma(funcion);
  return {
    ingresos,
    totalIngresos: suma(ingresos),
    gastos,
    totalGastos: suma(gastos),
    resultado: r2(suma(ingresos) - suma(gastos)),
    funcion,
    totalFuncion,
    /** Costos de la clase 9 que no pasaron por la 79 (o al revés): debería ser 0. */
    sinAmarre: r2(totalFuncion - cargas79),
  };
}
