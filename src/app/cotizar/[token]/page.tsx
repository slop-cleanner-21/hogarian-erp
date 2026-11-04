import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemaProveedor } from "@/components/tema-proveedor";
import { createClient } from "@/lib/supabase/server";
import { Cotizacion, type CotizacionData } from "./cotizacion";

export const metadata: Metadata = {
  title: "Cotización",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function CotizarPage({ params }: PageProps<"/cotizar/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cotizacion", { p_token: token });
  const respuesta = data as (CotizacionData & { disponible: true }) | { disponible: false } | null;

  if (error || !respuesta?.disponible) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-4">
        <div className="flex justify-end">
          <TemaProveedor />
        </div>
        <p className="mt-[30vh] text-center text-[19px] font-medium">
          {/* El error de la base no se muestra tal cual: solo el de demasiados intentos. */}
          {error?.code === "P0429" ? "Demasiados intentos. Vuelve a intentarlo en unos minutos." : "Este link ya no está disponible"}
        </p>
      </main>
    );
  }
  return <Cotizacion token={token} data={respuesta} />;
}
