import { requireSesion } from "@/lib/supabase/server";

// Consultas de solo lectura que comparten varias áreas (orden con sus entregas y fotos).
export default async function Layout({ children }: LayoutProps<"/consulta">) {
  await requireSesion(["GERENCIA", "TESORERIA", "CONTABILIDAD", "ASISTENTE_CONTABILIDAD", "LOGISTICA"]);
  return <div className="pb-10">{children}</div>;
}
