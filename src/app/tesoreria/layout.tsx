import { PanelAsistente } from "@/components/asistente";
import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: LayoutProps<"/tesoreria">) {
  const sesion = await requireSesion(["TESORERIA"]);
  return (
    <>
      <div className="pb-24">
        {children}
        <PanelAsistente userId={sesion.userId} />
      </div>
      <BottomNav />
    </>
  );
}
