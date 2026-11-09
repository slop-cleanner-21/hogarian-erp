import { ROLES_CONTABILIDAD } from "@/lib/prod1";
import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: LayoutProps<"/contabilidad">) {
  await requireSesion(ROLES_CONTABILIDAD);
  return (
    <>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
