import { ROLES_SEGUIMIENTO } from "@/lib/prod1";
import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: LayoutProps<"/operaciones">) {
  await requireSesion(ROLES_SEGUIMIENTO);
  return (
    <>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
