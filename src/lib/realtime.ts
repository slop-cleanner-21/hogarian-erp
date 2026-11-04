"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type Fila = { obra_id?: number; numero?: string; numero_oc?: string };

/**
 * Abre un canal de Realtime con la sesión del usuario: sin el token, Supabase lo trata como
 * anónimo y rechaza los filtros (la RLS no lo deja ver las filas). Si el canal falla, reintenta.
 * Devuelve la función para cerrarlo.
 */
export function abrirCanal(supabase: SupabaseClient, armar: () => RealtimeChannel): () => void {
  let canal: RealtimeChannel | null = null;
  let cerrado = false;
  let reintento: ReturnType<typeof setTimeout> | null = null;

  const conectar = async () => {
    const { data } = await supabase.auth.getSession();
    if (cerrado) return;
    if (data.session) await supabase.realtime.setAuth(data.session.access_token);
    canal = armar().subscribe((estado) => {
      if ((estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") && !cerrado) {
        void supabase.removeChannel(canal!);
        reintento = setTimeout(conectar, 5000);
      }
    });
  };
  void conectar();
  // El token se renueva: el canal debe seguir autenticado.
  const { data: sub } = supabase.auth.onAuthStateChange((_e, sesion) => {
    if (sesion) void supabase.realtime.setAuth(sesion.access_token);
  });

  return () => {
    cerrado = true;
    if (reintento) clearTimeout(reintento);
    sub.subscription.unsubscribe();
    if (canal) void supabase.removeChannel(canal);
  };
}

/**
 * Refresca la pantalla cuando cambia la orden (estado, cotización) o alguna de sus líneas
 * (p. ej. el proveedor envió sus precios por el link). Usa Supabase Realtime (WebSocket);
 * si no está disponible, la pantalla funciona igual, sin actualizarse sola.
 */
export function useCambiosOrden(obraId: number, numero: string) {
  const router = useRouter();
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const esDeLaOrden = (f: Fila | null) => f != null && (f.numero ?? f.numero_oc) === numero;
    const refrescar = (p: { new: Fila | null; old: Fila | null }) => {
      if (!esDeLaOrden(p.new) && !esDeLaOrden(p.old)) return;
      // Varias filas cambian juntas (una por línea): un solo refresco.
      if (espera.current) clearTimeout(espera.current);
      espera.current = setTimeout(() => router.refresh(), 300);
    };
    const cerrar = abrirCanal(supabase, () =>
      supabase
        .channel(`orden-${obraId}-${numero}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ordenes_compra", filter: `obra_id=eq.${obraId}` }, (p) =>
          refrescar(p as unknown as { new: Fila | null; old: Fila | null }),
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "oc_items", filter: `obra_id=eq.${obraId}` }, (p) =>
          refrescar(p as unknown as { new: Fila | null; old: Fila | null }),
        ),
    );
    return () => {
      if (espera.current) clearTimeout(espera.current);
      cerrar();
    };
  }, [obraId, numero, router]);
}
