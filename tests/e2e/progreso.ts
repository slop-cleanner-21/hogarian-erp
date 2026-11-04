import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

// Reporter de la suite: una barra con cuántas pruebas van de cuántas, el porcentaje, lo que pasó y lo que falló, el
// tiempo y lo que falta. Las fallas se muestran en cuanto ocurren (con su primera línea de error) y al final,
// juntas. En una terminal la barra se actualiza en su lugar; si la salida no es una terminal (CI, un log), imprime
// una línea cada 10 %. El detalle de cada prueba: REPORTE=list.

const ANCHO = 30;
const reloj = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const corto = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

export default class Progreso implements Reporter {
  private total = 0;
  private hechas = 0;
  private bien = 0;
  private saltadas = 0;
  private fallas: string[] = [];
  private inicio = Date.now();
  private ultimoDecil = -1;
  private ultimaLinea = "";
  private readonly tty = !!process.stdout.isTTY;

  printsToStdio() {
    return true;
  }

  onBegin(_: FullConfig, suite: Suite) {
    this.total = suite.allTests().length;
    this.inicio = Date.now();
    process.stdout.write(`Corriendo ${this.total} pruebas\n`);
    this.pintar();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Con reintentos, solo cuenta el último intento de cada prueba.
    if (result.status !== "passed" && result.status !== "skipped" && result.retry < test.retries) return;
    this.hechas += 1;
    if (result.status === "skipped") this.saltadas += 1;
    else if (test.outcome() === "expected" || test.outcome() === "flaky") this.bien += 1;
    else {
      const proyecto = test.parent.project()?.name ?? "";
      const donde = `[${proyecto}] ${test.titlePath().slice(2).join(" › ")}`;
      const error = (result.error?.message ?? result.status).replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 160);
      this.fallas.push(`${donde}\n     ${error}`);
      this.limpiar();
      process.stdout.write(`  ✘ ${donde}\n     ${error}\n`);
    }
    this.pintar();
  }

  onEnd(result: FullResult) {
    this.limpiar();
    this.pintar(true);
    process.stdout.write("\n");
    const tiempo = corto(Date.now() - this.inicio);
    if (this.fallas.length) {
      process.stdout.write(`\n  Fallaron ${this.fallas.length}:\n`);
      for (const f of this.fallas) process.stdout.write(`  ✘ ${f}\n`);
      process.stdout.write(`\n  ${this.fallas.length} failed\n`);
    }
    if (this.saltadas) process.stdout.write(`  ${this.saltadas} skipped\n`);
    // Las de un proyecto que depende de otro con fallas no llegan a correr (p. ej. el flujo).
    const sinCorrer = this.total - this.hechas;
    if (sinCorrer > 0 && result.status !== "interrupted") process.stdout.write(`  ${sinCorrer} sin correr (dependen de pruebas que fallaron)\n`);
    process.stdout.write(`  ${this.bien} passed (${tiempo})\n`);
    if (result.status === "interrupted") process.stdout.write("  (interrumpida)\n");
  }

  private limpiar() {
    if (this.tty) process.stdout.write("\r\x1b[2K");
  }

  private pintar(final = false) {
    const fraccion = this.total ? this.hechas / this.total : 0;
    const decil = Math.floor(fraccion * 10);
    // Fuera de una terminal: una línea cada 10 % (y la última).
    if (!this.tty && !final && decil === this.ultimoDecil) return;
    this.ultimoDecil = decil;
    const llenas = Math.round(fraccion * ANCHO);
    const barra = "█".repeat(llenas) + "░".repeat(ANCHO - llenas);
    const pasado = Date.now() - this.inicio;
    // Lo que falta, al ritmo de lo hecho hasta ahora.
    const faltan = this.total - this.hechas;
    const resta = this.hechas > 0 && faltan > 0 ? ` · faltan ~${reloj((pasado / this.hechas) * faltan)}` : "";
    const linea =
      `[${barra}] ${this.hechas}/${this.total} ${String(Math.round(fraccion * 100)).padStart(3)}%` +
      `  ✓ ${this.bien}${this.fallas.length ? `  ✘ ${this.fallas.length}` : ""}${this.saltadas ? `  ↷ ${this.saltadas}` : ""}` +
      `  ${reloj(pasado)}${final ? "" : resta}`;
    if (!this.tty && linea === this.ultimaLinea) return;
    this.ultimaLinea = linea;
    process.stdout.write(this.tty ? `\r\x1b[2K${linea}` : `${linea}\n`);
  }
}
