// Tipos derivados del esquema real (src/lib/database.types.ts, generado con
// `npm run db:types`). No escribir a mano columnas de vistas: si cambia la BD, regenerar.
import type { Database } from "./database.types";

type Public = Database["public"];
type Row<T extends keyof Public["Tables"]> = Public["Tables"][T]["Row"];
type View<T extends keyof Public["Views"]> = Public["Views"][T]["Row"];

export type Rol = Public["Enums"]["rol"];
export type Rubro = Public["Enums"]["rubro"];
export type TipoOrden = Public["Enums"]["tipo_orden"];
export type EstadoOC = Public["Enums"]["estado_oc"];
export type TipoComprobante = Public["Enums"]["tipo_comprobante"];

export type Obra = Row<"obras">;
export type Empresa = Row<"empresas">;
export type Proveedor = Row<"proveedores">;
export type Item = Row<"items">;
export type CuentaContable = Row<"cuentas_contables">;

export type VPartida = View<"v_partidas">;
export type VOrden = View<"v_ordenes">;
export type VOcItem = View<"v_oc_items">;
export type VPendientePago = View<"v_pendientes_pago">;
export type VRegistroCompra = View<"v_registro_compras">;
export type VItemSinCuenta = View<"v_items_sin_cuenta">;

export const ESTADO_LABEL: Record<EstadoOC, string> = {
  BORRADOR: "Borrador",
  EMITIDA: "Cotizando",
  PRECIOS_CONFIRMADOS: "Por facturar",
  FACTURADA: "Por enviar",
  EN_TESORERIA: "En Tesorería",
  PAGADA: "Pagada",
  // Prod 1: la constancia de pago ya se envió al proveedor (todavía no se registra lo que llega).
  EN_ENTREGA: "Enviada",
  RECIBIDA: "Recibida",
  ANULADA: "Anulada",
};

export const TIPO_COMPROBANTE_LABEL: Record<TipoComprobante, string> = {
  FACTURA: "Factura",
  RXH: "Recibo por honorarios",
  BOLETA: "Boleta",
  RECIBO_SIMPLE: "Recibo simple",
  OTRO: "Otro",
};
