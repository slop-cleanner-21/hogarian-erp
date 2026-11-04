"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Campana de avisos con el número de no leídos; se actualiza en tiempo real. Está en todas las pantallas: el
 * cliente de Supabase (~67 KB gzip) se carga después, cuando el navegador queda libre, y no compite con lo que se
 * ve al abrir.
 */
export function Campana({ userId }: { userId: string }) {
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    let vivo = true;
    let cerrar = () => {};
    const iniciar = async () => {
      const [{ createClient }, { abrirCanal }] = await Promise.all([import("@/lib/supabase/client"), import("@/lib/realtime")]);
      if (!vivo) return;
      const supabase = createClient();
      const contar = async () => {
        const { count } = await supabase
          .from("notificaciones")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("leida_at", null);
        if (vivo) setPendientes(count ?? 0);
      };
      void contar();
      cerrar = abrirCanal(supabase, () =>
        supabase
          .channel(`avisos-${userId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "notificaciones", filter: `user_id=eq.${userId}` }, () => {
            void contar();
          }),
      );
    };
    const ocioso = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 300));
    const cancelar = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ocioso(() => void iniciar(), { timeout: 2000 });
    return () => {
      vivo = false;
      cancelar(id);
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
