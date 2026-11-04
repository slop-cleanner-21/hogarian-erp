import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: LayoutProps<"/tesoreria">) {
  await requireSesion(["TESORERIA"]);
  return (
    <>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
