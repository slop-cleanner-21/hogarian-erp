import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { fecha, money, precio, qty } from "@/lib/format";
import type { VOcItem, VOrden } from "@/lib/types";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  label: { color: "#666", width: 70 },
  head: { flexDirection: "row", borderBottom: "1 solid #111", paddingBottom: 4, marginTop: 16, fontFamily: "Helvetica-Bold" },
  line: { flexDirection: "row", borderBottom: "0.5 solid #ccc", paddingVertical: 4 },
  cN: { width: 22 },
  cD: { flex: 1, paddingRight: 6 },
  cU: { width: 40 },
  cQ: { width: 56, textAlign: "right" },
  cP: { width: 60, textAlign: "right" },
  cT: { width: 70, textAlign: "right" },
});

// OC: solo qué y cuánto se pide (los precios se definen en la cotización).
// OS: lleva precios, porque es como se le comunican al proveedor (casi nunca cambian).
export function OrdenDoc({ orden, items }: { orden: VOrden; items: VOcItem[] }) {
  const conPrecios = orden.tipo === "OS";
  const titulo = orden.tipo === "OC" ? "ORDEN DE COMPRA" : "ORDEN DE SERVICIO";
  return (
    <Document title={`${orden.tipo} ${orden.numero}`}>
      <Page size="A4" style={s.page}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View>
            <Text style={s.h1}>{orden.empresa}</Text>
            {orden.empresa_ruc && <Text>RUC {orden.empresa_ruc}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h1}>{titulo}</Text>
            <Text style={{ fontSize: 12 }}>N° {orden.numero}</Text>
          </View>
        </View>
        <View style={{ marginTop: 14, gap: 3 }}>
          <View style={s.row}><Text style={s.label}>Fecha</Text><Text>{fecha(orden.fecha)}</Text></View>
          <View style={s.row}><Text style={s.label}>Obra</Text><Text>{orden.obra}</Text></View>
          <View style={s.row}><Text style={s.label}>Proveedor</Text><Text>{orden.proveedor}</Text></View>
          <View style={s.row}><Text style={s.label}>RUC / DNI</Text><Text>{orden.proveedor_ruc}</Text></View>
        </View>
        <View style={s.head}>
          <Text style={s.cN}>#</Text>
          <Text style={s.cD}>Descripción</Text>
          <Text style={s.cU}>Und</Text>
          <Text style={s.cQ}>Cant.</Text>
          {conPrecios && <Text style={s.cP}>P.U.</Text>}
          {conPrecios && <Text style={s.cT}>Parcial</Text>}
        </View>
        {items.map((it, i) => (
          <View key={it.id} style={s.line} wrap={false}>
            <Text style={s.cN}>{i + 1}</Text>
            <Text style={s.cD}>{it.descripcion}</Text>
            <Text style={s.cU}>{it.unidad}</Text>
            <Text style={s.cQ}>{qty(it.cantidad)}</Text>
            {conPrecios && <Text style={s.cP}>{precio(it.pu_efectivo ?? it.pu_partida)}</Text>}
            {conPrecios && <Text style={s.cT}>{money(it.parcial ?? Number(it.pu_partida) * Number(it.cantidad))}</Text>}
          </View>
        ))}
        {conPrecios && (
          <View style={[s.row, { justifyContent: "flex-end", marginTop: 8 }]}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              Total S/ {money(items.reduce((a, it) => a + Number(it.parcial ?? Number(it.pu_partida) * Number(it.cantidad)), 0))}
            </Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function ordenPdfBlob(orden: VOrden, items: VOcItem[]) {
  return pdf(<OrdenDoc orden={orden} items={items} />).toBlob();
}
