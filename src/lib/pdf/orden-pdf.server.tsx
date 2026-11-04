import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { VOcItem, VOrden } from "@/lib/types";
import { OrdenDoc } from "./orden-pdf";

/** PDF de la orden generado en el servidor (expediente ZIP). */
export function ordenPdfBuffer(orden: VOrden, items: VOcItem[]) {
  return renderToBuffer(<OrdenDoc orden={orden} items={items} />);
}
