import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { VOcItem, VOrden } from "@/lib/types";
import { ContratoDoc, type DatosContrato } from "./contrato-pdf";

/** El contrato de una OS generado en el servidor (el que el proveedor descarga desde su link para firmarlo). */
export function contratoPdfBuffer(orden: VOrden, items: VOcItem[], datos: DatosContrato) {
  return renderToBuffer(<ContratoDoc orden={orden} items={items} datos={datos} />);
}
