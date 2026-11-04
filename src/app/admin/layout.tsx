import type { ReactNode } from "react";
import { BottomNav } from "@/components/shell";
import { requireSesion } from "@/lib/supabase/server";

export default async function Layout({ children }: { children: ReactNode }) {
  await requireSesion(["ADMIN"]);
  return (
    <>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
