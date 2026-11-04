"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { abrirCanal } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/client";

/** Campana de avisos con el número de no leídos; se actualiza en tiempo real. */
export function Campana({ userId }: { userId: string }) {
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    const contar = async () => {
      const { count } = await supabase
        .from("notificaciones")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("leida_at", null);
      if (vivo) setPendientes(count ?? 0);
    };
    void contar();
    const cerrar = abrirCanal(supabase, () =>
      supabase
        .channel(`avisos-${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notificaciones", filter: `user_id=eq.${userId}` }, () => {
          void contar();
        }),
    );
    return () => {
      vivo = false;
      cerrar();
    };
  }, [userId]);

  return (
    <Link
      href="/avisos"
      aria-label={pendientes ? `Avisos (${pendientes} sin leer)` : "Avisos"}
      className="relative flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
    >
      <Bell size={22} />
      {pendientes > 0 && (
        <span className="num absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[12px] font-bold leading-none text-surface">
          {pendientes > 99 ? "99+" : pendientes}
        </span>
      )}
    </Link>
  );
}
