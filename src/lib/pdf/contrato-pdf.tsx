import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { money, precio, qty } from "@/lib/format";
import type { VOcItem, VOrden } from "@/lib/types";

// Sin guiones de corte: en un contrato no se parten nombres ni razones sociales.
Font.registerHyphenationCallback((palabra) => [palabra]);

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#111", lineHeight: 1.45 },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center" },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  b: { fontFamily: "Helvetica-Bold" },
  p: { textAlign: "justify" },
  punto: { flexDirection: "row", marginTop: 2 },
  vineta: { width: 12 },
  head: { flexDirection: "row", borderBottom: "1 solid #111", paddingBottom: 3, marginTop: 6, fontFamily: "Helvetica-Bold" },
  line: { flexDirection: "row", borderBottom: "0.5 solid #ccc", paddingVertical: 3 },
  total: { flexDirection: "row", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
  cD: { flex: 1, paddingRight: 6 },
  cU: { width: 36 },
  cQ: { width: 50, textAlign: "right" },
  cP: { width: 66, textAlign: "right" },
  cT: { width: 70, textAlign: "right" },
  glosa: { marginTop: 4, padding: 8, border: "1 solid #111" },
  firmas: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  firmaCol: { width: "42%" },
  firmaImg: { height: 44, justifyContent: "flex-end", alignItems: "center" },
  firma: { borderTop: "1 solid #111", paddingTop: 4, textAlign: "center" },
  membrete: { flexDirection: "row", alignItems: "center", marginBottom: 14, paddingBottom: 8, borderBottom: "0.5 solid #ccc" },
  logo: { height: 40, maxWidth: 160, objectFit: "contain" },
});

/** Quien firma por la empresa (el gerente): su firma va como imagen sobre la línea. */
export type Representante = { nombre: string; dni: string | null; firma: string | null };
/** OS: comprobante elegido (define el contrato), fecha de inicio y representante. */
export type DatosContrato = {
  comprobante: "RXH" | "FACTURA" | null;
  fechaInicio: string | null;
  representante: Representante | null;
  /** Razón social y domicilio de la empresa (Admin › Empresas); sin ellos, el nombre corto. */
  empresa?: { razonSocial: string | null; direccion: string | null };
  /** Logo de la empresa (URL de un PNG), arriba del contrato. */
  logo?: string | null;
  /** OS de retenciones: las OS cuya garantía devuelve. */
  retenidas?: { numero: string; fecha: string | null; retenido: number }[];
};

/** Arriba del contrato: el logo de la empresa (sin logo, nada). */
function Membrete({ logo }: { logo?: string | null }) {
  if (!logo) return null;
  return (
    <View style={s.membrete}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no un <img> */}
      <Image src={logo} style={s.logo} />
    </View>
  );
}

/** «HOGARIAN S.A.C., con RUC …, con domicilio en …» (lo que haya cargado el Admin). */
const nombreEmpresa = (orden: VOrden, datos?: DatosContrato) => datos?.empresa?.razonSocial || orden.empresa;
const domicilio = (datos?: DatosContrato) => (datos?.empresa?.direccion ? `, con domicilio en ${datos.empresa.direccion}` : "");

const ORDINAL = ["Primera", "Segunda", "Tercera", "Cuarta", "Quinta", "Sexta", "Séptima", "Octava", "Novena", "Décima", "Undécima", "Duodécima"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
};

const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const parcial = (it: VOcItem) => Number(it.parcial ?? Number(it.pu_efectivo ?? it.pu_partida) * Number(it.cantidad));
/** El P.U. que se le comunica al proveedor: el neto de la garantía (lo que factura entre la cantidad). */
const puNeto = (it: VOcItem) => (Number(it.cantidad) > 0 ? parcial(it) / Number(it.cantidad) : Number(it.pu_efectivo ?? it.pu_partida));

/** Debajo de los ítems: lo retenido por garantía (si hay) y el total que se factura. */
function Totales({ etiqueta, total, retenido }: { etiqueta: string; total: number; retenido: number }) {
  return (
    <>
      {retenido > 0.005 && (
        <>
          <View style={s.total}>
            <Text style={s.cD}>Subtotal</Text>
            <Text style={s.cT}>S/ {money(total + retenido)}</Text>
          </View>
          <View style={s.total}>
            <Text style={s.cD}>Retención por garantía</Text>
            <Text style={s.cT}>− S/ {money(retenido)}</Text>
          </View>
        </>
      )}
      <View style={s.total}>
        <Text style={s.cD}>{etiqueta}</Text>
        <Text style={s.cT}>S/ {money(total)}</Text>
      </View>
    </>
  );
}

/** Cláusula de la garantía: quién retiene, a quién y por cuánto se emite el comprobante. */
function Garantia({ retiene, a, total, retenido }: { retiene: string; a: string; total: number; retenido: number }) {
  if (retenido <= 0.005) return null;
  return (
    <Text style={[s.p, { marginTop: 3 }]}>
      Los precios de esta orden ya descuentan la retención por garantía de su correcta ejecución (S/ {money(retenido)}), que {retiene}{" "}
      devuelve a {a} después del cierre de la obra, mediante una orden de servicio de retenciones. {a} emite su comprobante por el total
      de esta orden, S/ {money(total)}.
    </Text>
  );
}

function Puntos({ children }: { children: string[] }) {
  return (
    <>
      {children.map((t) => (
        <View key={t} style={s.punto}>
          <Text style={s.vineta}>•</Text>
          <Text style={[s.p, { flex: 1 }]}>{t}</Text>
        </View>
      ))}
    </>
  );
}

/**
 * Contrato de una OS, por el 100 % de su monto, según el comprobante elegido al crearla:
 * - recibo por honorarios → locación de servicios (arts. 1764-1770 del Código Civil), con el concepto del recibo;
 * - factura → contrato comercial de prestación de servicios, sin concepto (detracción si corresponde).
 * Lo firma el proveedor y Logística sube el firmado. Plantilla base: el área legal la valida.
 */
export function ContratoDoc({ orden, items, datos }: { orden: VOrden; items: VOcItem[]; datos?: DatosContrato }) {
  const total = items.reduce((a, it) => a + parcial(it), 0);
  const retenido = items.reduce((a, it) => a + Number(it.retenido ?? 0), 0);
  const retenidas = datos?.retenidas;
  const doc = orden.proveedor_ruc ?? "";
  const dni = doc.length === 8;
  // Sin comprobante elegido (OS anteriores): por el documento, RUC 20 factura; DNI o RUC 10 recibo por honorarios.
  const empresa = datos?.comprobante ? datos.comprobante === "FACTURA" : doc.length === 11 && doc.startsWith("20");
  if (empresa && !retenidas) return <ContratoComercial orden={orden} items={items} datos={datos} total={total} retenido={retenido} />;
  const comprobante = empresa ? "factura electrónica" : "recibo por honorarios electrónico";

  const clausulas: { titulo: string; cuerpo: ReactNode }[] = [
    {
      titulo: "Objeto",
      cuerpo: retenidas ? (
        <>
          <Text style={s.p}>
            EL COMITENTE devuelve a EL LOCADOR, cerrada la obra {orden.obra}, lo que le retuvo por garantía en las siguientes órdenes de
            servicio, ya pagadas. La devolución consta en la orden de servicio N° {orden.numero}, que forma parte de este contrato:
          </Text>
          <View style={s.head}>
            <Text style={s.cD}>Orden de servicio</Text>
            <Text style={s.cP}>Fecha</Text>
            <Text style={s.cT}>Retenido</Text>
          </View>
          {retenidas.map((o) => (
            <View key={o.numero} style={s.line} wrap={false}>
              <Text style={s.cD}>OS {o.numero}</Text>
              <Text style={s.cP}>{o.fecha ? fechaCorta(o.fecha) : ""}</Text>
              <Text style={s.cT}>S/ {money(o.retenido)}</Text>
            </View>
          ))}
          <Totales etiqueta="Total" total={total} retenido={0} />
        </>
      ) : (
        <>
          <Text style={s.p}>
            EL LOCADOR se obliga a prestar a EL COMITENTE, por su cuenta y con autonomía, los siguientes servicios en la obra{" "}
            {orden.obra}, conforme a la orden de servicio N° {orden.numero}, que forma parte de este contrato:
          </Text>
          <View style={s.head}>
            <Text style={s.cD}>Servicio</Text>
            <Text style={s.cU}>Und</Text>
            <Text style={s.cQ}>Cant.</Text>
            <Text style={s.cP}>P.U.</Text>
            <Text style={s.cT}>Parcial</Text>
          </View>
          {items.map((it) => (
            <View key={it.id} style={s.line} wrap={false}>
              <Text style={s.cD}>{it.descripcion}</Text>
              <Text style={s.cU}>{it.unidad}</Text>
              <Text style={s.cQ}>{qty(it.cantidad)}</Text>
              <Text style={s.cP}>S/ {precio(puNeto(it))}</Text>
              <Text style={s.cT}>S/ {money(parcial(it))}</Text>
            </View>
          ))}
          <Totales etiqueta="Total" total={total} retenido={0} />
        </>
      ),
    },
    {
      titulo: "Plazo",
      cuerpo: (
        <Plazo orden={orden} datos={datos} quien="EL LOCADOR" />
      ),
    },
    {
      titulo: "Retribución y forma de pago",
      cuerpo: (
        <>
          {retenidas ? (
            <Text style={s.p}>
              El monto a devolver es de S/ {money(total)}. EL COMITENTE lo pagará por transferencia bancaria, previa entrega de su{" "}
              {comprobante} con el concepto indicado en la cláusula siguiente.
            </Text>
          ) : (
            <Text style={s.p}>
              La retribución total es de S/ {money(total)}, que corresponde al 100 % de la orden de servicio y cubre todos los
              costos de EL LOCADOR (personal, herramientas, traslados y cualquier otro gasto). EL COMITENTE la pagará por transferencia
              bancaria, previa conformidad del servicio y entrega del {comprobante} con el concepto indicado en la cláusula
              siguiente.
            </Text>
          )}
          <Garantia retiene="EL COMITENTE" a="EL LOCADOR" total={total} retenido={retenido} />
          <Text style={[s.p, { marginTop: 3 }]}>
            EL COMITENTE retendrá el impuesto a la renta de cuarta categoría cuando corresponda según ley (recibos de más de S/
            1,500), salvo que EL LOCADOR le acredite la suspensión de retenciones vigente. La retención forma parte del pago.
          </Text>
        </>
      ),
    },
    {
      titulo: "Concepto del comprobante",
      cuerpo: (
        <>
          <Text style={s.p}>EL LOCADOR emitirá su {comprobante} con el siguiente concepto:</Text>
          <Text style={s.glosa}>{orden.glosa_rhe ?? ""}</Text>
        </>
      ),
    },
    {
      titulo: "Obligaciones de EL LOCADOR",
      cuerpo: (
        <Puntos>
          {[
            "Ejecutar los servicios con diligencia, calidad y en los plazos acordados, con sus propios medios y herramientas.",
            "Cumplir las normas de seguridad y salud en el trabajo aplicables a la obra (Ley 29783 y Norma G.050) y las indicaciones de seguridad de EL COMITENTE.",
            "Si emplea personal o auxiliares, hacerlo bajo su exclusiva responsabilidad y cargo, incluidos sus seguros (SCTR cuando corresponda), remuneraciones y tributos.",
            "Reparar a su costo los defectos o daños que se deriven de su servicio.",
          ]}
        </Puntos>
      ),
    },
    {
      titulo: "Obligaciones de EL COMITENTE",
      cuerpo: (
        <Puntos>
          {[
            "Dar a EL LOCADOR acceso a la obra y la información necesaria para prestar el servicio.",
            "Pagar la retribución en la forma pactada.",
          ]}
        </Puntos>
      ),
    },
    {
      titulo: "Naturaleza civil",
      cuerpo: (
        <Text style={s.p}>
          Este contrato es de locación de servicios y se rige por los artículos 1764 y siguientes del Código Civil. EL LOCADOR
          presta sus servicios con autonomía, sin subordinación ni horario, por lo que no existe vínculo laboral entre las partes
          ni entre EL COMITENTE y el personal de EL LOCADOR. EL LOCADOR asume sus propias obligaciones tributarias y previsionales.
        </Text>
      ),
    },
    {
      titulo: "Confidencialidad",
      cuerpo: (
        <Text style={s.p}>
          EL LOCADOR mantendrá en reserva la información de EL COMITENTE y de la obra a la que acceda (planos, presupuestos,
          precios y datos de clientes) y solo la usará para prestar el servicio, aun después de terminado el contrato.
        </Text>
      ),
    },
    {
      titulo: "Resolución",
      cuerpo: (
        <Text style={s.p}>
          Si una parte incumple, la otra podrá requerirle por carta notarial que cumpla en un plazo de quince (15) días; vencido sin
          cumplimiento, el contrato quedará resuelto de pleno derecho (artículo 1429 del Código Civil). EL COMITENTE podrá además
          ponerle fin en cualquier momento con aviso escrito de cinco (5) días, pagando solo los servicios ejecutados con
          conformidad hasta esa fecha.
        </Text>
      ),
    },
    {
      titulo: "Jurisdicción",
      cuerpo: (
        <Text style={s.p}>
          Las partes procurarán resolver sus diferencias de buena fe. De no lograrlo, se someten a los jueces y tribunales del
          distrito judicial del domicilio de EL COMITENTE, y señalan como domicilios los que figuran en el Registro Único de
          Contribuyentes o, en su defecto, en su documento de identidad.
        </Text>
      ),
    },
  ];

  return (
    <Document title={`Contrato OS ${orden.numero}`}>
      <Page size="A4" style={s.page}>
        <Membrete logo={datos?.logo} />
        <Text style={s.h1}>CONTRATO DE LOCACIÓN DE SERVICIOS</Text>
        <Text style={{ textAlign: "center", marginTop: 2 }}>OS N° {orden.numero}</Text>

        <Text style={[s.p, { marginTop: 12 }]}>
          Conste por el presente documento el contrato de locación de servicios que celebran, de una parte,{" "}
          <Text style={s.b}>{nombreEmpresa(orden, datos)}</Text>, con RUC {orden.empresa_ruc ?? "—"}
          {domicilio(datos)}, <Representada />, en
          adelante EL COMITENTE; y de la otra, <Text style={s.b}>{orden.proveedor}</Text>, con {dni ? "DNI" : "RUC"} {doc}, en
          adelante EL LOCADOR; en los términos siguientes:
        </Text>

        <Clausulas clausulas={clausulas} />
        <Firmas orden={orden} datos={datos} empresa="EL COMITENTE" proveedor="EL LOCADOR" />
      </Page>
    </Document>
  );
}

/** La empresa comparece por su representante, sin sus datos personales (el contrato lleva los de la empresa). */
function Representada() {
  return <>debidamente representada</>;
}

function Plazo({ orden, datos, quien }: { orden: VOrden; datos?: DatosContrato; quien: string }) {
  return datos?.fechaInicio ? (
    <Text style={s.p}>
      {quien} prestó y presta los servicios desde el {fechaLarga(datos.fechaInicio)} hasta el {fechaLarga(orden.fecha)}, fecha de la
      orden de servicio, según el avance y la programación de la obra. El contrato rige hasta la conformidad de los servicios.
    </Text>
  ) : (
    <Text style={s.p}>
      El contrato rige desde su suscripción hasta la conformidad de los servicios. Los servicios se ejecutan según el avance y la
      programación de la obra que se le comunique a {quien}.
    </Text>
  );
}

function Clausulas({ clausulas }: { clausulas: { titulo: string; cuerpo: ReactNode }[] }) {
  return (
    <>
      {clausulas.map((c, i) => (
        <View key={c.titulo} wrap={i === 0}>
          <Text style={s.h2} minPresenceAhead={40}>
            {ORDINAL[i]}. {c.titulo}
          </Text>
          {c.cuerpo}
        </View>
      ))}
    </>
  );
}

/** Firmas: arriba de la línea, el espacio en blanco para firmar; debajo, la empresa (no los datos de quien firma) y el proveedor. */
function Firmas({ orden, datos, empresa, proveedor }: { orden: VOrden; datos?: DatosContrato; empresa: string; proveedor: string }) {
  const doc = orden.proveedor_ruc ?? "";
  return (
    <View wrap={false}>
      <Text style={[s.p, { marginTop: 14 }]}>
        En señal de conformidad, las partes firman el presente contrato en dos ejemplares, el {fechaLarga(orden.fecha)}.
      </Text>
      <View style={s.firmas}>
        <View style={s.firmaCol}>
          <View style={s.firmaImg} />
          <View style={s.firma}>
            <Text style={s.b}>{empresa}</Text>
            <Text>{nombreEmpresa(orden, datos)}</Text>
            <Text>RUC {orden.empresa_ruc ?? "—"}</Text>
          </View>
        </View>
        <View style={s.firmaCol}>
          <View style={s.firmaImg} />
          <View style={s.firma}>
            <Text style={s.b}>{proveedor}</Text>
            <Text>{orden.proveedor}</Text>
            <Text>
              {doc.length === 8 ? "DNI" : "RUC"} {doc}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Contrato comercial de prestación de servicios (proveedor con factura): sin concepto del comprobante; el pago
 * descuenta la detracción si el servicio está en el SPOT. Plantilla base: el área legal la valida.
 */
function ContratoComercial({ orden, items, datos, total, retenido }: { orden: VOrden; items: VOcItem[]; datos?: DatosContrato; total: number; retenido: number }) {
  const doc = orden.proveedor_ruc ?? "";
  const clausulas: { titulo: string; cuerpo: ReactNode }[] = [
    {
      titulo: "Objeto",
      cuerpo: (
        <>
          <Text style={s.p}>
            EL CONTRATISTA se obliga a ejecutar para LA EMPRESA, con su propia organización, personal y equipos, y bajo su
            responsabilidad, los siguientes servicios en la obra {orden.obra}, conforme a la orden de servicio N° {orden.numero}, que
            forma parte de este contrato:
          </Text>
          <View style={s.head}>
            <Text style={s.cD}>Servicio</Text>
            <Text style={s.cU}>Und</Text>
            <Text style={s.cQ}>Cant.</Text>
            <Text style={s.cP}>P.U.</Text>
            <Text style={s.cT}>Parcial</Text>
          </View>
          {items.map((it) => (
            <View key={it.id} style={s.line} wrap={false}>
              <Text style={s.cD}>{it.descripcion}</Text>
              <Text style={s.cU}>{it.unidad}</Text>
              <Text style={s.cQ}>{qty(it.cantidad)}</Text>
              <Text style={s.cP}>S/ {precio(puNeto(it))}</Text>
              <Text style={s.cT}>S/ {money(parcial(it))}</Text>
            </View>
          ))}
          <Totales etiqueta="Total (incluye IGV)" total={total} retenido={0} />
        </>
      ),
    },
    { titulo: "Plazo", cuerpo: <Plazo orden={orden} datos={datos} quien="EL CONTRATISTA" /> },
    {
      titulo: "Precio y forma de pago",
      cuerpo: (
        <>
          <Text style={s.p}>
            El precio total es de S/ {money(total)}, incluido el IGV, por el 100 % de la orden de servicio. Es a suma alzada y cubre
            todos los costos de EL CONTRATISTA (personal, materiales menores, herramientas, equipos, traslados, seguros y tributos).
            LA EMPRESA lo pagará por transferencia bancaria, previa conformidad del servicio y entrega de la factura electrónica
            correspondiente.
          </Text>
          <Garantia retiene="LA EMPRESA" a="EL CONTRATISTA" total={total} retenido={retenido} />
          <Text style={[s.p, { marginTop: 3 }]}>
            Si el servicio está sujeto al Sistema de Pago de Obligaciones Tributarias (detracciones), LA EMPRESA depositará el
            porcentaje que corresponda en la cuenta de detracciones de EL CONTRATISTA en el Banco de la Nación y le pagará el saldo;
            ambos pagos extinguen la obligación.
          </Text>
        </>
      ),
    },
    {
      titulo: "Obligaciones de EL CONTRATISTA",
      cuerpo: (
        <Puntos>
          {[
            "Ejecutar los servicios con calidad, según las especificaciones técnicas y planos de la obra, y en los plazos acordados.",
            "Cumplir las normas de seguridad y salud en el trabajo aplicables a la obra (Ley 29783 y Norma G.050) y las indicaciones de seguridad de LA EMPRESA.",
            "Contar con su propio personal, a su cargo y bajo su dirección, con sus remuneraciones, beneficios, seguros (SCTR) y tributos al día.",
            "Responder por los defectos, vicios ocultos y daños que se deriven de su servicio, y subsanarlos a su costo.",
          ]}
        </Puntos>
      ),
    },
    {
      titulo: "Obligaciones de LA EMPRESA",
      cuerpo: (
        <Puntos>
          {["Dar a EL CONTRATISTA acceso a la obra y la información necesaria para el servicio.", "Pagar el precio en la forma pactada."]}
        </Puntos>
      ),
    },
    {
      titulo: "Autonomía",
      cuerpo: (
        <Text style={s.p}>
          EL CONTRATISTA ejecuta el servicio con autonomía técnica y organizativa. No existe vínculo laboral entre LA EMPRESA y
          EL CONTRATISTA ni con el personal de este, que depende solo de EL CONTRATISTA.
        </Text>
      ),
    },
    {
      titulo: "Confidencialidad",
      cuerpo: (
        <Text style={s.p}>
          EL CONTRATISTA mantendrá en reserva la información de LA EMPRESA y de la obra a la que acceda (planos, presupuestos,
          precios y datos de clientes) y solo la usará para el servicio, aun después de terminado el contrato.
        </Text>
      ),
    },
    {
      titulo: "Resolución",
      cuerpo: (
        <Text style={s.p}>
          Si una parte incumple, la otra podrá requerirle por carta notarial que cumpla en un plazo de quince (15) días; vencido sin
          cumplimiento, el contrato quedará resuelto de pleno derecho (artículo 1429 del Código Civil). LA EMPRESA podrá además
          ponerle fin con aviso escrito de cinco (5) días, pagando solo los servicios ejecutados con conformidad hasta esa fecha.
        </Text>
      ),
    },
    {
      titulo: "Jurisdicción",
      cuerpo: (
        <Text style={s.p}>
          Las partes procurarán resolver sus diferencias de buena fe. De no lograrlo, se someten a los jueces y tribunales del
          distrito judicial del domicilio de LA EMPRESA, y señalan como domicilios los que figuran en el Registro Único de
          Contribuyentes.
        </Text>
      ),
    },
  ];

  return (
    <Document title={`Contrato OS ${orden.numero}`}>
      <Page size="A4" style={s.page}>
        <Membrete logo={datos?.logo} />
        <Text style={s.h1}>CONTRATO DE PRESTACIÓN DE SERVICIOS</Text>
        <Text style={{ textAlign: "center", marginTop: 2 }}>OS N° {orden.numero}</Text>

        <Text style={[s.p, { marginTop: 12 }]}>
          Conste por el presente documento el contrato comercial de prestación de servicios que celebran, de una parte,{" "}
          <Text style={s.b}>{nombreEmpresa(orden, datos)}</Text>, con RUC {orden.empresa_ruc ?? "—"}
          {domicilio(datos)}, <Representada />, en
          adelante LA EMPRESA; y de la otra, <Text style={s.b}>{orden.proveedor}</Text>, con RUC {doc}, en adelante EL
          CONTRATISTA; en los términos siguientes:
        </Text>

        <Clausulas clausulas={clausulas} />
        <Firmas orden={orden} datos={datos} empresa="LA EMPRESA" proveedor="EL CONTRATISTA" />
      </Page>
    </Document>
  );
}

export async function contratoPdfBlob(orden: VOrden, items: VOcItem[], datos?: DatosContrato) {
  return pdf(<ContratoDoc orden={orden} items={items} datos={datos} />).toBlob();
}
