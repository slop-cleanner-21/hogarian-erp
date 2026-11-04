import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: LayoutProps<"/logistica">) {
  await requireSesion(["LOGISTICA"]);
  return (
    <>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
