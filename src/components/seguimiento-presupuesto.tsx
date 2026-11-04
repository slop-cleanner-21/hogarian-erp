import type { EntregaPartida } from "@/lib/entregas-partida";
import type { Grupo } from "@/lib/presupuesto";

export type FilaSeguimiento = {
  id: number;
  etapa: string;
  descripcion: string;
  /** REGULAR o «ADIC n» (las adicionales llevan su marca). */
  requerimiento?: string | null;
  unidad: string;
  presupuestado: number;
  pu: number | null;
  /** Presupuestado que Operaciones aún no requiere ni Logística compra. */
  porRequerir: number;
  enLogistica: number;
  enTesoreria: number;
  porRecibir: number;
  recibido: number;
  /** Lo requerido por Operaciones que Logística aún no compra. */
  requeridoPendiente: number;
  /** Adelantos: "+20 de L2A" (recibió de una etapa posterior) o "−20 a L1B" (prestó). */
  adelantos: string[];
  /** Lo que llegó, entrega por entrega con sus fotos (vacío si no se muestran). */
  entregas: EntregaPartida[];
  /** Mano de obra: retención acumulada (S/), se paga al cerrar la obra. */
  retencion?: number;
};

type Clave = "porRequerir" | "requeridoPendiente" | "enLogistica" | "enTesoreria" | "porRecibir" | "recibido";

/**
 * Estados del recorrido de lo presupuestado, en orden, con su color en la barra. Suman lo
 * presupuestado. En materiales «llega» (entregado); en subcontratos y mano de obra «se ejecuta».
 */
export function tramosDe(grupo: Grupo): { clave: Clave; label: string; color: string }[] {
  // Prod 1: sin requerimientos ni valorizaciones; la mano de obra se ordena en OS como los subcontratos.
  const materiales = grupo === "MATERIALES";
  return [
    { clave: "porRequerir", label: materiales ? "Por comprar" : "Por contratar", color: "bg-sunken ring-1 ring-inset ring-ink-3" },
    { clave: "enLogistica", label: "Pedido", color: "bg-ink-3/45" },
    { clave: "enTesoreria", label: "Por pagar", color: "bg-warn-line" },
    { clave: "porRecibir", label: materiales ? "Pagado sin entregar" : "Pagado sin ejecutar", color: "bg-primary" },
    { clave: "recibido", label: materiales ? "Entregado" : "Ejecutado", color: "bg-ok" },
  ];
}
