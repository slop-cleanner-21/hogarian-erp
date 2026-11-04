import type { Database } from "./database.types";

export type PorPagar = Database["public"]["Views"]["v_por_pagar"]["Row"];

export const hrefPago = (d: Pick<PorPagar, "doc" | "obra_id" | "numero" | "orden_pago_id">) =>
  d.doc === "OP"
    ? `/tesoreria/pago/op/${d.orden_pago_id}`
    : `/tesoreria/pago/${d.obra_id}/${encodeURIComponent(d.numero ?? "")}`;
